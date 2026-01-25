package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
)

func DisableUser(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		// Get authenticated admin user from context
		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Decode request
		var req admin.AdminDisableUserRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate request
		if errs := req.Validate(); len(errs) > 0 {
			log.Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Get target user by email from global DB
		targetUser, err := s.Global.GetAdminUserByEmail(ctx, string(req.EmailAddress))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("target user not found", "email", req.EmailAddress)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get target user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check if target user is already disabled
		if targetUser.Status == globaldb.AdminUserStatusDisabled {
			log.Debug("target user already disabled")
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Check if trying to disable the last active admin
		count, err := s.Global.CountActiveAdminUsers(ctx)
		if err != nil {
			log.Error("failed to count active admin users", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if count <= 1 {
			log.Debug("cannot disable last admin user")
			w.WriteHeader(http.StatusUnprocessableEntity)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "Cannot disable last admin user",
			})
			return
		}

		// Update user status to disabled in global DB
		err = s.Global.UpdateAdminUserStatus(ctx, globaldb.UpdateAdminUserStatusParams{
			AdminUserID: targetUser.AdminUserID,
			Status:      globaldb.AdminUserStatusDisabled,
		})
		if err != nil {
			log.Error("failed to update user status", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Invalidate all sessions for the target user in global DB
		err = s.Global.DeleteAllAdminSessionsForUser(ctx, targetUser.AdminUserID)
		if err != nil {
			log.Error("failed to delete user sessions", "error", err)
			// User is disabled but sessions still active - this is acceptable
		}

		log.Info("admin user disabled successfully",
			"target_user_id", targetUser.AdminUserID,
			"disabled_by", adminUser.AdminUserID)

		w.WriteHeader(http.StatusOK)
	}
}
