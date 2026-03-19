package agency

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/agency"
	common "vetchium-api-server.typespec/common"
)

func AssignRole(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		// Get authenticated agency user from context
		agencyUser := middleware.AgencyUserFromContext(ctx)
		if agencyUser == nil {
			s.Logger(ctx).Debug("agency user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Decode request
		var req agency.AssignRoleRequest
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

		// Ensure role belongs to the agency portal
		if !strings.HasPrefix(string(req.RoleName), "agency:") {
			s.Logger(ctx).Debug("role does not belong to agency portal", "role_name", req.RoleName)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode([]common.ValidationError{
				common.NewValidationError("role_name", errors.New("must be an agency role")),
			})
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

		// Get target agency user from regional DB (verify exists and same agency)
		targetUser, err := s.Regional.GetAgencyUserByID(ctx, targetUserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("target agency user not found", "target_user_id", req.TargetUserID)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get target agency user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Verify target user belongs to same agency
		if targetUser.AgencyID != agencyUser.AgencyID {
			s.Logger(ctx).Debug("target user belongs to different agency",
				"target_user_id", targetUser.AgencyUserID,
				"target_agency_id", targetUser.AgencyID,
				"current_agency_id", agencyUser.AgencyID)
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

		// Check if user already has this role
		hasRole, err := s.Regional.HasAgencyUserRole(ctx, regionaldb.HasAgencyUserRoleParams{
			AgencyUserID: targetUser.AgencyUserID,
			RoleID:       role.RoleID,
		})
		if err != nil {
			s.Logger(ctx).Error("failed to check if user has role", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if hasRole {
			s.Logger(ctx).Debug("user already has role",
				"target_user_id", targetUser.AgencyUserID,
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
			"target_user_id":    targetUser.AgencyUserID.String(),
			"target_email_hash": hex.EncodeToString(targetEmailHash[:]),
			"role_name":         string(req.RoleName),
		})
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if txErr := qtx.AssignAgencyUserRole(ctx, regionaldb.AssignAgencyUserRoleParams{
				AgencyUserID: targetUser.AgencyUserID,
				RoleID:       role.RoleID,
			}); txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:    "agency.assign_role",
				ActorUserID:  agencyUser.AgencyUserID,
				TargetUserID: targetUser.AgencyUserID,
				OrgID:        agencyUser.AgencyID,
				IpAddress:    audit.ExtractClientIP(r),
				EventData:    eventData,
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to assign role", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("role assigned to agency user",
			"agency_user_id", agencyUser.AgencyUserID,
			"target_user_id", targetUser.AgencyUserID,
			"role_name", req.RoleName)

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{
			"message": "role assigned successfully",
		})
	}
}
