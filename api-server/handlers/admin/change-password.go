package admin

import (
	"encoding/json"
	"net/http"

	"golang.org/x/crypto/bcrypt"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
)

// ChangePassword handles POST /admin/change-password
// Allows an authenticated admin user to change their password
func ChangePassword(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		// Get authenticated admin user from context
		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			s.Logger(ctx).Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Decode request
		var req admin.AdminChangePasswordRequest
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

		// Get full admin user record to verify current password
		fullUser, err := s.Global.GetAdminUserByID(ctx, adminUser.AdminUserID)
		if err != nil {
			s.Logger(ctx).Error("failed to get admin user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Verify current password
		if err := bcrypt.CompareHashAndPassword(fullUser.PasswordHash, []byte(req.CurrentPassword)); err != nil {
			s.Logger(ctx).Debug("current password verification failed")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Hash new password
		passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			s.Logger(ctx).Error("failed to hash password", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Update password and write audit log atomically
		session := middleware.AdminSessionFromContext(ctx)
		if session.SessionToken == "" {
			s.Logger(ctx).Error("session not found in context")
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		err = s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			if err := qtx.UpdateAdminUserPassword(ctx, globaldb.UpdateAdminUserPasswordParams{
				AdminUserID:  adminUser.AdminUserID,
				PasswordHash: passwordHash,
			}); err != nil {
				return err
			}
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.change_password",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte("{}"),
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to update password", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Invalidate all other sessions except the current one (best-effort, outside tx)
		err = s.Global.DeleteAllAdminSessionsExceptCurrent(ctx, globaldb.DeleteAllAdminSessionsExceptCurrentParams{
			AdminUserID:  adminUser.AdminUserID,
			SessionToken: session.SessionToken,
		})
		if err != nil {
			s.Logger(ctx).Error("failed to invalidate other sessions", "error", err)
			// Continue - password was updated successfully
		}

		s.Logger(ctx).Info("password changed", "admin_user_id", adminUser.AdminUserID)

		w.WriteHeader(http.StatusOK)
	}
}
