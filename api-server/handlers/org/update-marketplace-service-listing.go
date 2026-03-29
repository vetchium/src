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

// UpdateMarketplaceServiceListing handles POST /org/update-marketplace-service-listing
func UpdateMarketplaceServiceListing(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.UpdateMarketplaceServiceListingRequest
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

		// Look up listing by name (name is the natural key)
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

		// Only certain states allow editing
		switch existing.State {
		case regionaldb.ServiceListingStateDraft,
			regionaldb.ServiceListingStateActive,
			regionaldb.ServiceListingStatePaused,
			regionaldb.ServiceListingStateRejected:
			// allowed
		default:
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		var pricingInfo pgtype.Text
		if req.PricingInfo != nil {
			pricingInfo = pgtype.Text{String: *req.PricingInfo, Valid: true}
		}
		var industriesServedOther pgtype.Text
		if req.IndustriesServedOther != nil {
			industriesServedOther = pgtype.Text{String: *req.IndustriesServedOther, Valid: true}
		}

		industriesServed := make([]string, len(req.IndustriesServed))
		for i, ind := range req.IndustriesServed {
			industriesServed[i] = string(ind)
		}
		companySizesServed := make([]string, len(req.CompanySizesServed))
		for i, cs := range req.CompanySizesServed {
			companySizesServed[i] = string(cs)
		}
		jobFunctionsSourced := make([]string, len(req.JobFunctionsSourced))
		for i, jf := range req.JobFunctionsSourced {
			jobFunctionsSourced[i] = string(jf)
		}
		seniorityLevelsSourced := make([]string, len(req.SeniorityLevelsSourced))
		for i, sl := range req.SeniorityLevelsSourced {
			seniorityLevelsSourced[i] = string(sl)
		}

		var updated regionaldb.MarketplaceServiceListing
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			// Rejected listings stay rejected; changed_since_rejection is set to true
			// so that the provider can subsequently submit for review.
			// Active/paused go to pending_review. Draft stays draft.
			switch existing.State {
			case regionaldb.ServiceListingStateDraft:
				updated, txErr = qtx.UpdateServiceListingDraft(ctx, regionaldb.UpdateServiceListingDraftParams{
					Name:                      req.Name,
					ShortBlurb:                req.ShortBlurb,
					Description:               req.Description,
					CountriesOfService:        req.CountriesOfService,
					ContactUrl:                req.ContactURL,
					PricingInfo:               pricingInfo,
					IndustriesServed:          industriesServed,
					IndustriesServedOther:     industriesServedOther,
					CompanySizesServed:        companySizesServed,
					JobFunctionsSourced:       jobFunctionsSourced,
					SeniorityLevelsSourced:    seniorityLevelsSourced,
					GeographicSourcingRegions: req.GeographicSourcingRegions,
					ServiceListingID:          existing.ServiceListingID,
					OrgID:                     orgUser.OrgID,
				})
			case regionaldb.ServiceListingStateRejected:
				updated, txErr = qtx.UpdateRejectedServiceListing(ctx, regionaldb.UpdateRejectedServiceListingParams{
					Name:                      req.Name,
					ShortBlurb:                req.ShortBlurb,
					Description:               req.Description,
					CountriesOfService:        req.CountriesOfService,
					ContactUrl:                req.ContactURL,
					PricingInfo:               pricingInfo,
					IndustriesServed:          industriesServed,
					IndustriesServedOther:     industriesServedOther,
					CompanySizesServed:        companySizesServed,
					JobFunctionsSourced:       jobFunctionsSourced,
					SeniorityLevelsSourced:    seniorityLevelsSourced,
					GeographicSourcingRegions: req.GeographicSourcingRegions,
					ServiceListingID:          existing.ServiceListingID,
					OrgID:                     orgUser.OrgID,
				})
			default:
				// active, paused -> pending_review immediately
				updated, txErr = qtx.UpdateServiceListingToPendingReview(ctx, regionaldb.UpdateServiceListingToPendingReviewParams{
					Name:                      req.Name,
					ShortBlurb:                req.ShortBlurb,
					Description:               req.Description,
					CountriesOfService:        req.CountriesOfService,
					ContactUrl:                req.ContactURL,
					PricingInfo:               pricingInfo,
					IndustriesServed:          industriesServed,
					IndustriesServedOther:     industriesServedOther,
					CompanySizesServed:        companySizesServed,
					JobFunctionsSourced:       jobFunctionsSourced,
					SeniorityLevelsSourced:    seniorityLevelsSourced,
					GeographicSourcingRegions: req.GeographicSourcingRegions,
					ServiceListingID:          existing.ServiceListingID,
					OrgID:                     orgUser.OrgID,
				})
			}
			if txErr != nil {
				return txErr
			}

			eventData, _ := json.Marshal(map[string]any{
				"name": req.Name,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "marketplace.update_service_listing",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to update service listing", "error", err)
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

		log.Info("service listing updated", "name", req.Name)
		json.NewEncoder(w).Encode(dbServiceListingToAPI(updated, orgDomain))
	}
}
