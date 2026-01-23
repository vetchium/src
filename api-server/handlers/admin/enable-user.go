package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
)

func EnableUser(s *server.Server) http.HandlerFunc {
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
		var req admin.AdminEnableUserRequest
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

		// Parse target user ID
		var targetUserID pgtype.UUID
		if err := targetUserID.Scan(req.TargetUserID); err != nil {
			log.Debug("invalid target_user_id format", "error", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		// Get target user from global DB
		targetUser, err := s.Global.GetAdminUserByID(ctx, targetUserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("target user not found", "target_user_id", req.TargetUserID)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get target user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check if target user is in disabled state
		if targetUser.Status != globaldb.AdminUserStatusDisabled {
			log.Debug("target user not in disabled state", "status", targetUser.Status)
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Update user status to active in global DB
		err = s.Global.UpdateAdminUserStatus(ctx, globaldb.UpdateAdminUserStatusParams{
			AdminUserID: targetUserID,
			Status:      globaldb.AdminUserStatusActive,
		})
		if err != nil {
			log.Error("failed to update user status", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("admin user enabled successfully",
			"target_user_id", targetUser.AdminUserID,
			"enabled_by", adminUser.AdminUserID)

		w.WriteHeader(http.StatusOK)
	}
}
