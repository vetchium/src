package employer

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	common "vetchium-api-server.typespec/common"
	"vetchium-api-server.typespec/employer"
)

func RemoveRole(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		// Get authenticated org user from context
		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			s.Logger(ctx).Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Decode request
		var req employer.RemoveRoleRequest
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

		// Get target org user from regional DB (verify exists and same employer)
		targetUser, err := s.Regional.GetOrgUserByID(ctx, targetUserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("target org user not found", "target_user_id", req.TargetUserID)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get target org user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Verify target user belongs to same employer
		if targetUser.EmployerID != orgUser.EmployerID {
			s.Logger(ctx).Debug("target user belongs to different employer",
				"target_user_id", targetUser.OrgUserID,
				"target_employer_id", targetUser.EmployerID,
				"current_employer_id", orgUser.EmployerID)
			w.WriteHeader(http.StatusForbidden)
			return
		}

		// Get role by name from regional DB (verify exists)
		role, err := s.Regional.GetRoleByName(ctx, string(req.RoleName))
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

		// The has-role check, last-superadmin guard, and the removal are all
		// inside a single transaction to prevent race conditions.
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			// Check if user has this role
			hasRole, err := qtx.HasOrgUserRole(ctx, regionaldb.HasOrgUserRoleParams{
				OrgUserID: targetUser.OrgUserID,
				RoleID:    role.RoleID,
			})
			if err != nil {
				return err
			}
			if !hasRole {
				return server.ErrConflict
			}

			// Guard against removing the last active superadmin's role
			if string(req.RoleName) == "employer:superadmin" {
				lockedSuperadmins, err := qtx.LockActiveOrgUsersWithRole(ctx, regionaldb.LockActiveOrgUsersWithRoleParams{
					EmployerID: targetUser.EmployerID,
					RoleID:     role.RoleID,
				})
				if err != nil {
					return err
				}
				if len(lockedSuperadmins) <= 1 {
					return server.ErrInvalidState
				}
			}

			if txErr := qtx.RemoveOrgUserRole(ctx, regionaldb.RemoveOrgUserRoleParams{
				OrgUserID: targetUser.OrgUserID,
				RoleID:    role.RoleID,
			}); txErr != nil {
				return txErr
			}
			eventData, _ := json.Marshal(map[string]any{"role_name": string(req.RoleName)})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:    "employer.remove_role",
				ActorUserID:  orgUser.OrgUserID,
				TargetUserID: targetUser.OrgUserID,
				OrgID:        orgUser.EmployerID,
				IpAddress:    audit.ExtractClientIP(r),
				EventData:    eventData,
			})
		})
		if err != nil {
			if errors.Is(err, server.ErrConflict) {
				s.Logger(ctx).Debug("user does not have role",
					"target_user_id", targetUser.OrgUserID,
					"role_name", req.RoleName)
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "user does not have this role",
				})
				return
			}
			if errors.Is(err, server.ErrInvalidState) {
				s.Logger(ctx).Debug("cannot remove last superadmin role",
					"target_user_id", targetUser.OrgUserID)
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

		s.Logger(ctx).Info("role removed from org user",
			"org_user_id", orgUser.OrgUserID,
			"target_user_id", targetUser.OrgUserID,
			"role_name", req.RoleName)

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{
			"message": "role removed successfully",
		})
	}
}
