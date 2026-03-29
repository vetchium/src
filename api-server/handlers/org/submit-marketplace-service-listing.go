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

// SubmitMarketplaceServiceListing handles POST /org/submit-marketplace-service-listing
func SubmitMarketplaceServiceListing(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.SubmitMarketplaceServiceListingRequest
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

		var updated regionaldb.MarketplaceServiceListing
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			updated, txErr = qtx.SubmitServiceListingForReview(ctx, regionaldb.SubmitServiceListingForReviewParams{
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
				EventType:   "marketplace.submit_service_listing",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// SubmitServiceListingForReview works for draft, and for rejected only
				// when changed_since_rejection=true.
				if listing.State == regionaldb.ServiceListingStateRejected && !listing.ChangedSinceRejection {
					log.Debug("rejected listing has no changes since rejection, cannot submit")
					w.WriteHeader(http.StatusUnprocessableEntity)
					return
				}
				log.Debug("service listing is in wrong state for submit", "state", listing.State)
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to submit service listing for review", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get org domain for response
		domains, err := s.Global.GetGlobalOrgDomainsByOrg(ctx, orgUser.OrgID)
		if err != nil || len(domains) == 0 {
			log.Error("failed to get org domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		orgDomain := domains[0].Domain

		log.Info("service listing submitted for review", "name", req.Name)
		json.NewEncoder(w).Encode(dbServiceListingToAPI(updated, orgDomain))
	}
}
