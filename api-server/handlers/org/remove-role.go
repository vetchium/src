package org

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/org"
)

func RemoveRole(s *server.RegionalServer) http.HandlerFunc {
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
		var req org.RemoveRoleRequest
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

		// Resolve email → org_user via global DB
		emailHash := sha256.Sum256([]byte(req.EmailAddress))
		globalTargetUser, err := s.Global.GetOrgUserByEmailHashAndOrg(ctx, globaldb.GetOrgUserByEmailHashAndOrgParams{
			EmailAddressHash: emailHash[:],
			OrgID:            orgUser.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("target org user not found", "email_address", req.EmailAddress)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to look up target org user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get target org user from regional DB (verify exists and same org)
		targetUser, err := s.Regional.GetOrgUserByID(ctx, globalTargetUser.OrgUserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("target org user not found in regional DB", "email_address", req.EmailAddress)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get target org user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Verify target user belongs to same org
		if targetUser.OrgID != orgUser.OrgID {
			s.Logger(ctx).Debug("target user belongs to different org",
				"target_user_id", targetUser.OrgUserID,
				"target_org_id", targetUser.OrgID,
				"current_org_id", orgUser.OrgID)
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
			if string(req.RoleName) == "org:superadmin" {
				lockedSuperadmins, err := qtx.LockActiveOrgUsersWithRole(ctx, regionaldb.LockActiveOrgUsersWithRoleParams{
					OrgID:  targetUser.OrgID,
					RoleID: role.RoleID,
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
			targetEmailHash := sha256.Sum256([]byte(targetUser.EmailAddress))
			eventData, _ := json.Marshal(map[string]any{
				"target_user_id":    targetUser.OrgUserID.String(),
				"target_email_hash": hex.EncodeToString(targetEmailHash[:]),
				"role_name":         string(req.RoleName),
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:    "org.remove_role",
				ActorUserID:  orgUser.OrgUserID,
				TargetUserID: targetUser.OrgUserID,
				OrgID:        orgUser.OrgID,
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
