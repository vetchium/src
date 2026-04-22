package org

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

func DiscoverListings(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.DiscoverListingsRequest
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

		limit := int32(20)
		if req.Limit != nil && *req.Limit > 0 {
			limit = *req.Limit
		}

		capabilityID := ""
		if req.CapabilityID != nil {
			capabilityID = *req.CapabilityID
		}

		searchText := ""
		if req.SearchText != nil {
			searchText = *req.SearchText
		}

		var paginationKey pgtype.UUID
		if req.PaginationKey != nil {
			if err := paginationKey.Scan(*req.PaginationKey); err != nil {
				http.Error(w, "invalid pagination_key", http.StatusBadRequest)
				return
			}
		}

		rows, err := s.Global.ListListingCatalogByCapability(ctx, globaldb.ListListingCatalogByCapabilityParams{
			CapabilityID:  capabilityID,
			PaginationKey: paginationKey,
			SearchText:    searchText,
			RowLimit:      limit + 1,
		})
		if err != nil {
			s.Logger(ctx).Error("failed to discover listings", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Fetch current org's active subscriptions to mark is_subscribed
		activeSubs, err := s.Regional.ListMarketplaceSubscriptionsByConsumer(ctx, regionaldb.ListMarketplaceSubscriptionsByConsumerParams{
			ConsumerOrgID: orgUser.OrgID,
			FilterStatus: regionaldb.NullMarketplaceSubscriptionStatus{
				MarketplaceSubscriptionStatus: regionaldb.MarketplaceSubscriptionStatusActive,
				Valid:                         true,
			},
			RowLimit: 1000, // Reasonable limit for active subs per org
		})
		if err != nil {
			s.Logger(ctx).Error("failed to fetch active subscriptions", "error", err)
			// Non-fatal
		}
		subscribedListingIDs := make(map[pgtype.UUID]bool)
		for _, sub := range activeSubs {
			subscribedListingIDs[sub.ListingID] = true
		}

		var nextKey *string
		if int32(len(rows)) > limit {
			rows = rows[:limit]
			k := uuidToString(rows[len(rows)-1].ListingID)
			nextKey = &k
		}

		cards := make([]orgspec.ListingCard, 0, len(rows))
		for _, row := range rows {
			cards = append(cards, orgspec.ListingCard{
				ListingID:     uuidToString(row.ListingID),
				OrgDomain:     row.OrgDomain,
				ListingNumber: row.ListingNumber,
				Headline:      row.Headline,
				Description:   row.Description,
				CapabilityIDs: row.CapabilityIds,
				ListedAt:      row.ListedAt.Time.Format(time.RFC3339),
				IsSubscribed:  subscribedListingIDs[row.ListingID],
			})
		}

		json.NewEncoder(w).Encode(orgspec.DiscoverListingsResponse{
			Listings:          cards,
			NextPaginationKey: nextKey,
		})
	}
}
