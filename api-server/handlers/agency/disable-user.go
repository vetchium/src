package agency

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
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

		// Get authenticated agency user from context
		agencyUser := middleware.AgencyUserFromContext(ctx)
		if agencyUser == nil {
			s.Logger(ctx).Debug("agency user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		// Decode request
		var req agency.AgencyDisableUserRequest
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

		// Calculate email hash
		emailHash := sha256.Sum256([]byte(req.EmailAddress))

		// Get target user from global DB (for routing info)
		targetGlobalUser, err := s.Global.GetAgencyUserByEmailHashAndAgency(ctx, globaldb.GetAgencyUserByEmailHashAndAgencyParams{
			EmailAddressHash: emailHash[:],
			AgencyID:         agencyUser.AgencyID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("target user not found", "email", req.EmailAddress)
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get target user", "error", err)
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

			if txErr := qtx.UpdateAgencyUserStatus(ctx, regionaldb.UpdateAgencyUserStatusParams{
				AgencyUserID: targetUser.AgencyUserID,
				Status:       regionaldb.AgencyUserStatusDisabled,
			}); txErr != nil {
				return txErr
			}
			eventData, _ := json.Marshal(map[string]any{"target_user_id": targetUser.AgencyUserID.String()})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:    "agency.disable_user",
				ActorUserID:  agencyUser.AgencyUserID,
				TargetUserID: targetUser.AgencyUserID,
				OrgID:        agencyUser.AgencyID,
				IpAddress:    audit.ExtractClientIP(r),
				EventData:    eventData,
			})
		})
		if err != nil {
			if errors.Is(err, server.ErrNotFound) {
				s.Logger(ctx).Debug("target user not found in regional DB")
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if errors.Is(err, server.ErrInvalidState) {
				s.Logger(ctx).Debug("cannot disable user - already disabled or last superadmin")
				w.WriteHeader(http.StatusUnprocessableEntity)
				json.NewEncoder(w).Encode(map[string]string{
					"error": "Cannot disable user: already disabled or last superadmin",
				})
				return
			}
			s.Logger(ctx).Error("failed to disable agency user", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Invalidate all sessions for the target user (best-effort, outside tx)
		if err := s.Regional.DeleteAllAgencySessionsForUser(ctx, targetUserID); err != nil {
			s.Logger(ctx).Error("failed to delete user sessions", "error", err)
			// User is disabled but sessions still active - this is acceptable
		}

		s.Logger(ctx).Info("agency user disabled successfully",
			"target_user_id", targetUserID,
			"disabled_by", agencyUser.AgencyUserID)

		w.WriteHeader(http.StatusOK)
	}
}
