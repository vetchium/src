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
	common "vetchium-api-server.typespec/common"
)

func AssignRole(s *server.GlobalServer) http.HandlerFunc {
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
		var req admin.AssignRoleRequest
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

		// Parse target user ID as UUID
		var targetUserID pgtype.UUID
		if err := targetUserID.Scan(req.TargetUserID); err != nil {
			log.Debug("invalid target user ID", "error", err)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode([]common.ValidationError{
				common.NewValidationError("target_user_id", errors.New("invalid UUID format")),
			})
			return
		}

		// Get target admin user (verify exists)
		targetUser, err := s.Global.GetAdminUserByID(ctx, targetUserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("target admin user not found", "target_user_id", req.TargetUserID)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get target admin user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get role by name (verify exists)
		role, err := s.Global.GetRoleByName(ctx, string(req.RoleName))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("role not found", "role_name", req.RoleName)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get role", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check if user already has this role
		hasRole, err := s.Global.HasAdminUserRole(ctx, globaldb.HasAdminUserRoleParams{
			AdminUserID: targetUser.AdminUserID,
			RoleID:      role.RoleID,
		})
		if err != nil {
			log.Error("failed to check if user has role", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if hasRole {
			log.Debug("user already has role",
				"target_user_id", targetUser.AdminUserID,
				"role_name", req.RoleName)
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "user already has this role",
			})
			return
		}

		// Assign role
		err = s.Global.AssignAdminUserRole(ctx, globaldb.AssignAdminUserRoleParams{
			AdminUserID: targetUser.AdminUserID,
			RoleID:      role.RoleID,
		})
		if err != nil {
			log.Error("failed to assign role", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("role assigned to admin user",
			"admin_user_id", adminUser.AdminUserID,
			"target_user_id", targetUser.AdminUserID,
			"role_name", req.RoleName)

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{
			"message": "role assigned successfully",
		})
	}
}
