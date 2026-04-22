package org

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

func GetMarketplaceListing(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.GetListingRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		orgRecord, err := s.Global.GetOrgByID(ctx, orgUser.OrgID)
		if err != nil {
			s.Logger(ctx).Error("failed to get org", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// If requesting own listing, return full record from regional DB
		if req.OrgDomain == orgRecord.OrgName {
			listing, err := s.Regional.GetMarketplaceListingByDomainAndNumber(ctx, regionaldb.GetMarketplaceListingByDomainAndNumberParams{
				OrgDomain:     req.OrgDomain,
				ListingNumber: req.ListingNumber,
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				s.Logger(ctx).Error("failed to get listing", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			caps, err := s.Regional.ListCurrentCapabilitiesForListing(ctx, listing.ListingID)
			if err != nil {
				s.Logger(ctx).Error("failed to fetch capabilities", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			json.NewEncoder(w).Encode(buildListingFromRow(ctx, listing, caps, 0, false))
			return
		}

		// Cross-org: read from global catalog (only active listings are catalogued)
		catalog, err := s.Global.GetListingCatalogByDomainAndNumber(ctx, globaldb.GetListingCatalogByDomainAndNumberParams{
			OrgDomain:     req.OrgDomain,
			ListingNumber: req.ListingNumber,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get catalog listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		isSubscribed, err := s.Regional.HasActiveSubscriptionForListing(ctx, regionaldb.HasActiveSubscriptionForListingParams{
			ConsumerOrgID: orgUser.OrgID,
			ListingID:     catalog.ListingID,
		})
		if err != nil {
			s.Logger(ctx).Error("failed to check subscription status", "error", err)
			// Non-fatal, default to false
		}

		listedAt := catalog.ListedAt.Time.Format(time.RFC3339)
		listing := orgspec.MarketplaceListing{
			ListingID:             uuidToString(catalog.ListingID),
			OrgDomain:             catalog.OrgDomain,
			ListingNumber:         catalog.ListingNumber,
			Headline:              catalog.Headline,
			Description:           catalog.Description,
			Capabilities:          catalog.CapabilityIds,
			Status:                orgspec.MarketplaceListingStatusActive,
			ListedAt:              &listedAt,
			ActiveSubscriberCount: 0,
			CreatedAt:             catalog.ListedAt.Time.Format(time.RFC3339),
			UpdatedAt:             catalog.UpdatedAt.Time.Format(time.RFC3339),
			IsSubscribed:          isSubscribed,
		}
		json.NewEncoder(w).Encode(listing)
	}
}
