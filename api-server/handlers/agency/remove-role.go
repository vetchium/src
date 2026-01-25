package agency

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/agency"
)

func RemoveRole(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		// Get authenticated agency user from context
		agencyUser := middleware.AgencyUserFromContext(ctx)
		if agencyUser == nil {
			log.Debug("agency user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Check if user is an admin
		if !agencyUser.IsAdmin {
			log.Debug("non-admin agency user attempted to remove role",
				"agency_user_id", agencyUser.AgencyUserID)
			w.WriteHeader(http.StatusForbidden)
			return
		}

		// Decode request
		var req agency.RemoveRoleRequest
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
			http.Error(w, "invalid target user ID", http.StatusBadRequest)
			return
		}

		// Get target agency user (verify exists)
		targetUser, err := s.Global.GetAgencyUserByID(ctx, targetUserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("target agency user not found", "target_user_id", req.TargetUserID)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get target agency user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Verify target user belongs to same agency
		if targetUser.AgencyID != agencyUser.AgencyID {
			log.Debug("target user belongs to different agency",
				"target_user_id", targetUser.AgencyUserID,
				"target_agency_id", targetUser.AgencyID,
				"current_agency_id", agencyUser.AgencyID)
			w.WriteHeader(http.StatusForbidden)
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

		// Check if user has this role
		hasRole, err := s.Global.HasAgencyUserRole(ctx, globaldb.HasAgencyUserRoleParams{
			AgencyUserID: targetUser.AgencyUserID,
			RoleID:       role.RoleID,
		})
		if err != nil {
			log.Error("failed to check if user has role", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if !hasRole {
			log.Debug("user does not have role",
				"target_user_id", targetUser.AgencyUserID,
				"role_name", req.RoleName)
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{
				"error": "user does not have this role",
			})
			return
		}

		// Remove role
		err = s.Global.RemoveAgencyUserRole(ctx, globaldb.RemoveAgencyUserRoleParams{
			AgencyUserID: targetUser.AgencyUserID,
			RoleID:       role.RoleID,
		})
		if err != nil {
			log.Error("failed to remove role", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("role removed from agency user",
			"agency_user_id", agencyUser.AgencyUserID,
			"target_user_id", targetUser.AgencyUserID,
			"role_name", req.RoleName)

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{
			"message": "role removed successfully",
		})
	}
}
