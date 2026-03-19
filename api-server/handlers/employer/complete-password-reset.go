package employer

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/proxy"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.gomodule/internal/tokens"
	"vetchium-api-server.typespec/employer"
)

func CompletePasswordReset(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		bodyBytes, err := proxy.BufferBody(r)
		if err != nil {
			http.Error(w, "", http.StatusBadRequest)
			return
		}

		ctx := r.Context()

		var req employer.OrgCompletePasswordResetRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate request
		if validationErrors := req.Validate(); len(validationErrors) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", validationErrors)
			w.WriteHeader(http.StatusBadRequest)
			if err := json.NewEncoder(w).Encode(validationErrors); err != nil {
				s.Logger(ctx).Error("failed to encode validation errors", "error", err)
			}
			return
		}

		// Extract region from token
		region, _, err := tokens.ExtractRegionFromToken(string(req.ResetToken))
		if err != nil {
			s.Logger(ctx).Debug("invalid reset token format", "error", err)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Proxy to correct region if needed
		if region != s.CurrentRegion {
			s.ProxyToRegion(w, r, region, bodyBytes)
			return
		}

		// Look up reset token (includes expiry check)
		resetTokenRecord, err := s.Regional.GetOrgPasswordResetToken(ctx, string(req.ResetToken))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("reset token not found or expired")
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			s.Logger(ctx).Error("failed to get reset token", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Hash new password
		passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			s.Logger(ctx).Error("failed to hash password", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Look up org user to get employer_id for audit log
		orgUser, err := s.Regional.GetOrgUserByID(ctx, resetTokenRecord.OrgUserGlobalID)
		if err != nil {
			s.Logger(ctx).Error("failed to get org user for audit log", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Update password, delete token, invalidate sessions, and write audit log atomically
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			txErr := qtx.UpdateOrgUserPassword(ctx, regionaldb.UpdateOrgUserPasswordParams{
				OrgUserID:    resetTokenRecord.OrgUserGlobalID,
				PasswordHash: passwordHash,
			})
			if txErr != nil {
				return txErr
			}
			if txErr = qtx.DeleteOrgPasswordResetToken(ctx, string(req.ResetToken)); txErr != nil {
				return txErr
			}
			if txErr = qtx.DeleteAllOrgSessionsForUser(ctx, resetTokenRecord.OrgUserGlobalID); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:    "employer.complete_password_reset",
				TargetUserID: resetTokenRecord.OrgUserGlobalID,
				OrgID:        orgUser.EmployerID,
				IpAddress:    audit.ExtractClientIP(r),
				EventData:    []byte("{}"),
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to complete password reset", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("password reset completed", "org_user_id", resetTokenRecord.OrgUserGlobalID)

		w.WriteHeader(http.StatusOK)
	}
}
