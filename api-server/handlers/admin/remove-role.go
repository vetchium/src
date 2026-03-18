package admin

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/admin"
	common "vetchium-api-server.typespec/common"
)

func RemoveRole(s *server.GlobalServer) http.HandlerFunc {
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
		var req admin.RemoveRoleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate request
		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Parse target user ID as UUID
		var targetUserID pgtype.UUID
		if err := targetUserID.Scan(req.TargetUserID); err != nil {
			s.Logger(ctx).Debug("invalid target user ID", "error", err)
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
				s.Logger(ctx).Debug("target admin user not found", "target_user_id", req.TargetUserID)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get target admin user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get role by name (verify exists)
		role, err := s.Global.GetRoleByName(ctx, string(req.RoleName))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("role not found", "role_name", req.RoleName)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get role", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// The has-role check, last-superadmin guard, removal, and audit log are all
		// inside a single transaction to prevent race conditions.
		targetEmailHash := sha256.Sum256([]byte(targetUser.EmailAddress))
		eventData, _ := json.Marshal(map[string]any{
			"target_user_id":    targetUser.AdminUserID.String(),
			"target_email_hash": hex.EncodeToString(targetEmailHash[:]),
			"role_name":         string(req.RoleName),
		})
		err = s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			// Check if user has this role
			hasRole, err := qtx.HasAdminUserRole(ctx, globaldb.HasAdminUserRoleParams{
				AdminUserID: targetUser.AdminUserID,
				RoleID:      role.RoleID,
			})
			if err != nil {
				return err
			}
			if !hasRole {
				return server.ErrConflict
			}

			// Guard against removing the last active superadmin's role
			if string(req.RoleName) == "admin:superadmin" {
				lockedSuperadmins, err := qtx.LockActiveAdminUsersWithRole(ctx, role.RoleID)
				if err != nil {
					return err
				}
				if len(lockedSuperadmins) <= 1 {
					return server.ErrInvalidState
				}
			}

			if err := qtx.RemoveAdminUserRole(ctx, globaldb.RemoveAdminUserRoleParams{
				AdminUserID: targetUser.AdminUserID,
				RoleID:      role.RoleID,
			}); err != nil {
				return err
			}
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:    "admin.remove_role",
				ActorUserID:  adminUser.AdminUserID,
				TargetUserID: targetUser.AdminUserID,
				IpAddress:    audit.ExtractClientIP(r),
				EventData:    eventData,
			})
		})
		if err != nil {
			if errors.Is(err, server.ErrConflict) {
				s.Logger(ctx).Debug("user does not have role",
					"target_user_id", targetUser.AdminUserID,
					"role_name", req.RoleName)
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "user does not have this role",
				})
				return
			}
			if errors.Is(err, server.ErrInvalidState) {
				s.Logger(ctx).Debug("cannot remove last superadmin role",
					"target_user_id", targetUser.AdminUserID)
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "Cannot remove superadmin role from the last active superadmin",
				})
				return
			}
			s.Logger(ctx).Error("failed to remove role", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("role removed from admin user",
			"admin_user_id", adminUser.AdminUserID,
			"target_user_id", targetUser.AdminUserID,
			"role_name", req.RoleName)

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{
			"message": "role removed successfully",
		})
	}
}
