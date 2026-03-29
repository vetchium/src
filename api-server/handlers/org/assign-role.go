package org

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	common "vetchium-api-server.typespec/common"
	"vetchium-api-server.typespec/org"
)

func AssignRole(s *server.RegionalServer) http.HandlerFunc {
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
		var req org.AssignRoleRequest
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

		// Ensure role belongs to the org portal
		if !strings.HasPrefix(string(req.RoleName), "org:") {
			s.Logger(ctx).Debug("role does not belong to org portal", "role_name", req.RoleName)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode([]common.ValidationError{
				common.NewValidationError("role_name", errors.New("must be an org role")),
			})
			return
		}

		// Get target org user by email within the same org
		targetUser, err := s.Regional.GetOrgUserByEmailAndOrg(ctx, regionaldb.GetOrgUserByEmailAndOrgParams{
			EmailAddress: req.EmailAddress,
			OrgID:        orgUser.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("target org user not found", "email_address", req.EmailAddress)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get target org user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
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

		// Check if user already has this role
		hasRole, err := s.Regional.HasOrgUserRole(ctx, regionaldb.HasOrgUserRoleParams{
			OrgUserID: targetUser.OrgUserID,
			RoleID:    role.RoleID,
		})
		if err != nil {
			s.Logger(ctx).Error("failed to check if user has role", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if hasRole {
			s.Logger(ctx).Debug("user already has role",
				"target_user_id", targetUser.OrgUserID,
				"role_name", req.RoleName)
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "user already has this role",
			})
			return
		}

		// Assign role and write audit log atomically
		targetEmailHash := sha256.Sum256([]byte(targetUser.EmailAddress))
		eventData, _ := json.Marshal(map[string]any{
			"target_email_hash": hex.EncodeToString(targetEmailHash[:]),
			"role_name":         string(req.RoleName),
		})
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if txErr := qtx.AssignOrgUserRole(ctx, regionaldb.AssignOrgUserRoleParams{
				OrgUserID: targetUser.OrgUserID,
				RoleID:    role.RoleID,
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:    "org.assign_role",
				ActorUserID:  orgUser.OrgUserID,
				TargetUserID: targetUser.OrgUserID,
				OrgID:        orgUser.OrgID,
				IpAddress:    audit.ExtractClientIP(r),
				EventData:    eventData,
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to assign role", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("role assigned to org user",
			"org_user_id", orgUser.OrgUserID,
			"target_user_id", targetUser.OrgUserID,
			"role_name", req.RoleName)

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{
			"message": "role assigned successfully",
		})
	}
}
