package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
)

// CompletePasswordReset handles POST /admin/complete-password-reset
// Completes the password reset using the reset token
func CompletePasswordReset(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		// Decode request
		var req admin.AdminCompletePasswordResetRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate request
		if validationErrors := req.Validate(); len(validationErrors) > 0 {
			log.Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				log.Error("failed to encode validation errors", "error", err)
			}
			return
		}

		// Verify reset token (includes expiry check)
		resetToken, err := s.Global.GetAdminPasswordResetToken(ctx, string(req.ResetToken))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("invalid or expired reset token")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			log.Error("failed to query reset token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Hash new password
		passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			log.Error("failed to hash password", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Update password, delete token, and write audit log atomically
		err = s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			if err := qtx.UpdateAdminUserPassword(ctx, globaldb.UpdateAdminUserPasswordParams{
				AdminUserID:  resetToken.AdminUserID,
				PasswordHash: passwordHash,
			}); err != nil {
				return err
			}
			if err := qtx.DeleteAdminPasswordResetToken(ctx, string(req.ResetToken)); err != nil {
				return err
			}
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:    "admin.complete_password_reset",
				TargetUserID: resetToken.AdminUserID,
				IpAddress:    audit.ExtractClientIP(r),
				EventData:    []byte("{}"),
			})
		})
		if err != nil {
			log.Error("failed to complete password reset", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Invalidate all existing sessions for this user (best-effort, outside tx)
		if err = s.Global.DeleteAllAdminSessionsForUser(ctx, resetToken.AdminUserID); err != nil {
			log.Error("failed to invalidate sessions", "error", err)
		}

		log.Info("password reset completed", "admin_user_id", resetToken.AdminUserID)

		w.WriteHeader(http.StatusOK)
	}
}
