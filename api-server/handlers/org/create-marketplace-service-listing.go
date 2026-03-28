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

const maxNonArchivedServiceListings = 20

// CreateMarketplaceServiceListing handles POST /org/create-marketplace-service-listing
func CreateMarketplaceServiceListing(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.CreateMarketplaceServiceListingRequest
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

		// Check quota: max 20 non-archived service listings
		count, err := s.Regional.CountNonArchivedServiceListings(ctx, orgUser.OrgID)
		if err != nil {
			log.Error("failed to count service listings", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		if count >= maxNonArchivedServiceListings {
			log.Debug("service listing quota exceeded", "count", count)
			w.WriteHeader(http.StatusConflict)
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

		// Convert slice types
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

		var listing regionaldb.MarketplaceServiceListing
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			listing, txErr = qtx.CreateServiceListing(ctx, regionaldb.CreateServiceListingParams{
				OrgID:                     orgUser.OrgID,
				Name:                      req.Name,
				ShortBlurb:                req.ShortBlurb,
				Description:               req.Description,
				ServiceCategory:           regionaldb.ServiceCategory(req.ServiceCategory),
				CountriesOfService:        req.CountriesOfService,
				ContactUrl:                req.ContactURL,
				PricingInfo:               pricingInfo,
				IndustriesServed:          industriesServed,
				IndustriesServedOther:     industriesServedOther,
				CompanySizesServed:        companySizesServed,
				JobFunctionsSourced:       jobFunctionsSourced,
				SeniorityLevelsSourced:    seniorityLevelsSourced,
				GeographicSourcingRegions: req.GeographicSourcingRegions,
			})
			if txErr != nil {
				return txErr
			}

			eventData, _ := json.Marshal(map[string]any{
				"service_listing_id": uuidToString(listing.ServiceListingID),
				"name":               listing.Name,
				"category":           string(listing.ServiceCategory),
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "marketplace.create_service_listing",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			log.Error("failed to create service listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("service listing created", "service_listing_id", uuidToString(listing.ServiceListingID))
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(orgtypes.CreateMarketplaceServiceListingResponse{
			ServiceListingID: uuidToString(listing.ServiceListingID),
		})
	}
}
