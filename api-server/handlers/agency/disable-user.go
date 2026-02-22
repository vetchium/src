package agency

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
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

		// All checks and the status update are inside a single transaction to
		// prevent race conditions (e.g. two parallel requests both disabling
		// the last superadmin).
		var targetUserID pgtype.UUID
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			// Re-read target user from regional DB inside the transaction
			targetUser, err := qtx.GetAgencyUserByID(ctx, targetGlobalUser.AgencyUserID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return server.ErrNotFound
				}
				return err
			}
			targetUserID = targetUser.AgencyUserID

			// Check if target user is already disabled
			if targetUser.Status == regionaldb.AgencyUserStatusDisabled {
				return server.ErrInvalidState
			}

			// Lock all active superadmins for this agency to prevent race
			// conditions when checking last-superadmin constraint.
			superadminRole, err := qtx.GetRoleByName(ctx, "agency:superadmin")
			if err != nil {
				return err
			}

			lockedSuperadmins, err := qtx.LockActiveAgencyUsersWithRole(ctx, regionaldb.LockActiveAgencyUsersWithRoleParams{
				AgencyID: targetUser.AgencyID,
				RoleID:   superadminRole.RoleID,
			})
			if err != nil {
				return err
			}

			// Check whether the target is the last active superadmin
			targetIsSuperadmin := slices.Contains(lockedSuperadmins, targetUser.AgencyUserID)
			if targetIsSuperadmin && len(lockedSuperadmins) <= 1 {
				return server.ErrInvalidState
			}

			return qtx.UpdateAgencyUserStatus(ctx, regionaldb.UpdateAgencyUserStatusParams{
				AgencyUserID: targetUser.AgencyUserID,
				Status:       regionaldb.AgencyUserStatusDisabled,
			})
		})
		if err != nil {
			if errors.Is(err, server.ErrNotFound) {
				log.Debug("target user not found in regional DB")
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if errors.Is(err, server.ErrInvalidState) {
				log.Debug("cannot disable user - already disabled or last superadmin")
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "Cannot disable user: already disabled or last superadmin",
				})
				return
			}
			log.Error("failed to disable agency user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Invalidate all sessions for the target user (best-effort, outside tx)
		if err := s.Regional.DeleteAllAgencySessionsForUser(ctx, targetUserID); err != nil {
			log.Error("failed to delete user sessions", "error", err)
			// User is disabled but sessions still active - this is acceptable
		}

		log.Info("agency user disabled successfully",
			"target_user_id", targetUserID,
			"disabled_by", agencyUser.AgencyUserID)

		w.WriteHeader(http.StatusOK)
	}
}
