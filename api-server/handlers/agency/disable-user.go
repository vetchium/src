package agency

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
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

		// Calculate email hash
		emailHash := sha256.Sum256([]byte(req.EmailAddress))

		// Get target user from global DB (for routing info)
		targetGlobalUser, err := s.Global.GetAgencyUserByEmailHashAndAgency(ctx, globaldb.GetAgencyUserByEmailHashAndAgencyParams{
			EmailAddressHash: emailHash[:],
			AgencyID:         agencyUser.AgencyID,
		})
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

		// Get regional DB
		region := middleware.AgencyRegionFromContext(ctx)
		if region == "" {
			log.Error("region not found in context")
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		regionalDB := s.GetRegionalDB(globaldb.Region(region))
		if regionalDB == nil {
			log.Error("regional database not available", "region", region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get target user from regional DB (for status and isAdmin)
		targetRegionalUser, err := regionalDB.GetAgencyUserByID(ctx, targetGlobalUser.AgencyUserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				log.Debug("target user not found in regional DB")
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get target user from regional DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check if target user is already disabled
		if targetRegionalUser.Status == regionaldb.AgencyUserStatusDisabled {
			log.Debug("target user already disabled")
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Check if current user has permission (is_admin or has manage_users role)
		if !agencyUser.IsAdmin {
			log.Debug("user lacks permission to disable users")
			w.WriteHeader(http.StatusForbidden)
			return
		}

		// If target user is an admin, check if they are the last admin
		if targetRegionalUser.IsAdmin {
			count, err := regionalDB.CountActiveAdminAgencyUsers(ctx, targetRegionalUser.AgencyID)
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

		// Update user status to disabled in regional DB
		err = regionalDB.UpdateAgencyUserStatus(ctx, regionaldb.UpdateAgencyUserStatusParams{
			AgencyUserID: targetGlobalUser.AgencyUserID,
			Status:       regionaldb.AgencyUserStatusDisabled,
		})
		if err != nil {
			log.Error("failed to update user status", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Invalidate all sessions for the target user in regional DB
		err = regionalDB.DeleteAllAgencySessionsForUser(ctx, targetGlobalUser.AgencyUserID)
		if err != nil {
			log.Error("failed to delete user sessions", "error", err)
			// User is disabled but sessions still active - this is acceptable
		}

		log.Info("agency user disabled successfully",
			"target_user_id", targetGlobalUser.AgencyUserID,
			"disabled_by", agencyUser.AgencyUserID)

		w.WriteHeader(http.StatusOK)
	}
}
