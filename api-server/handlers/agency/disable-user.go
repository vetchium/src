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

func DisableUser(s *server.Server) http.HandlerFunc {
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

		// Decode request
		var req agency.AgencyDisableUserRequest
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
		targetUser, err := s.Global.GetAgencyUserByID(ctx, targetUserID)
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

		// Check if target user belongs to the same agency
		if targetUser.AgencyID != agencyUser.AgencyID {
			log.Debug("target user belongs to different agency")
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Check if target user is already disabled
		if targetUser.Status == globaldb.AgencyUserStatusDisabled {
			log.Debug("target user already disabled")
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Check if current user has permission (is_admin or has manage_users role)
		// TODO: Once role system is implemented, check for manage_users role here
		if !agencyUser.IsAdmin {
			log.Debug("user lacks permission to disable users")
			w.WriteHeader(http.StatusForbidden)
			return
		}

		// If target user is an admin, check if they are the last admin
		if targetUser.IsAdmin {
			count, err := s.Global.CountActiveAdminAgencyUsers(ctx, targetUser.AgencyID)
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
		}

		// Update user status to disabled in global DB
		err = s.Global.UpdateAgencyUserStatus(ctx, globaldb.UpdateAgencyUserStatusParams{
			AgencyUserID: targetUserID,
			Status:       globaldb.AgencyUserStatusDisabled,
		})
		if err != nil {
			log.Error("failed to update user status", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Invalidate all sessions for the target user in regional DB
		regionalDB := s.GetRegionalDB(targetUser.HomeRegion)
		if regionalDB == nil {
			log.Error("regional database not available", "region", targetUser.HomeRegion)
			// User is disabled but sessions still active - this is acceptable
			// Sessions will expire naturally
		} else {
			err = regionalDB.DeleteAllAgencySessionsForUser(ctx, targetUser.AgencyUserID)
			if err != nil {
				log.Error("failed to delete user sessions", "error", err)
				// User is disabled but sessions still active - this is acceptable
			}
		}

		log.Info("agency user disabled successfully",
			"target_user_id", targetUser.AgencyUserID,
			"disabled_by", agencyUser.AgencyUserID)

		w.WriteHeader(http.StatusOK)
	}
}
