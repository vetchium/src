package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

// PauseMarketplaceServiceListing handles POST /org/pause-marketplace-service-listing
func PauseMarketplaceServiceListing(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.PauseMarketplaceServiceListingRequest
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
		listing, err := s.Regional.GetServiceListingByOrgAndName(ctx, regionaldb.GetServiceListingByOrgAndNameParams{
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

		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			_, txErr := qtx.PauseServiceListing(ctx, regionaldb.PauseServiceListingParams{
				ServiceListingID: listing.ServiceListingID,
				OrgID:            orgUser.OrgID,
			})
			if txErr != nil {
				return txErr
			}

			eventData, _ := json.Marshal(map[string]any{
				"name": req.Name,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "marketplace.pause_service_listing",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// PauseServiceListing only works for active state.
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to pause service listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("service listing paused", "name", req.Name)
		w.WriteHeader(http.StatusOK)
	}
}
