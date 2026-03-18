package agency

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/agency"
)

func EnableUser(s *server.Server) http.HandlerFunc {
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
		var req agency.AgencyEnableUserRequest
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

		// Get target user from regional DB (for status check)
		targetRegionalUser, err := s.Regional.GetAgencyUserByID(ctx, targetGlobalUser.AgencyUserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger(ctx).Debug("target user not found in regional DB")
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get target user from regional DB", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check if target user is in disabled state
		if targetRegionalUser.Status != regionaldb.AgencyUserStatusDisabled {
			s.Logger(ctx).Debug("target user not in disabled state", "status", targetRegionalUser.Status)
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Update user status to active and write audit log atomically
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if txErr := qtx.UpdateAgencyUserStatus(ctx, regionaldb.UpdateAgencyUserStatusParams{
				AgencyUserID: targetGlobalUser.AgencyUserID,
				Status:       regionaldb.AgencyUserStatusActive,
			}); txErr != nil {
				return txErr
			}
			eventData, _ := json.Marshal(map[string]any{"target_user_id": targetGlobalUser.AgencyUserID.String()})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:    "agency.enable_user",
				ActorUserID:  agencyUser.AgencyUserID,
				TargetUserID: targetGlobalUser.AgencyUserID,
				OrgID:        agencyUser.AgencyID,
				IpAddress:    audit.ExtractClientIP(r),
				EventData:    eventData,
			})
		})
		if err != nil {
			s.Logger(ctx).Error("failed to update user status", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		s.Logger(ctx).Info("agency user enabled successfully",
			"target_user_id", targetGlobalUser.AgencyUserID,
			"enabled_by", agencyUser.AgencyUserID)

		w.WriteHeader(http.StatusOK)
	}
}
