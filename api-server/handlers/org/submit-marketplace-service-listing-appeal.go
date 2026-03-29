package org

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
	orgtypes "vetchium-api-server.typespec/org"
)

// SubmitMarketplaceServiceListingAppeal handles POST /org/submit-marketplace-service-listing-appeal
func SubmitMarketplaceServiceListingAppeal(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			log.Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.SubmitMarketplaceServiceListingAppealRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		if errs := req.Validate(); len(errs) > 0 {
			log.Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		// Check that org capability is active
		cap, err := s.Regional.GetOrgCapability(ctx, regionaldb.GetOrgCapabilityParams{
			OrgID:      orgUser.OrgID,
			Capability: "marketplace_provider",
		})
		if err != nil || cap.Status != regionaldb.OrgCapabilityStatusActive {
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				log.Error("failed to get org capability", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusForbidden)
			return
		}

		// Look up listing by name
		existing, err := s.Regional.GetServiceListingByOrgAndName(ctx, regionaldb.GetServiceListingByOrgAndNameParams{
			OrgID: orgUser.OrgID,
			Name:  req.Name,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get service listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if existing.AppealExhausted {
			log.Debug("appeal already exhausted for service listing", "name", req.Name)
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			_, txErr := qtx.SubmitServiceListingAppeal(ctx, regionaldb.SubmitServiceListingAppealParams{
				AppealReason:     pgtype.Text{String: req.AppealReason, Valid: true},
				ServiceListingID: existing.ServiceListingID,
				OrgID:            orgUser.OrgID,
			})
			if txErr != nil {
				return txErr
			}

			eventData, _ := json.Marshal(map[string]any{
				"name": req.Name,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "marketplace.submit_service_listing_appeal",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// SubmitServiceListingAppeal only works for suspended state with appeal_exhausted=false.
				// We already checked appeal_exhausted, so this means wrong state.
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to submit service listing appeal", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("service listing appeal submitted", "name", req.Name)
		w.WriteHeader(http.StatusOK)
	}
}
