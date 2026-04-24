package admin

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

func AdminListMarketplaceListings(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.AdminListListingsRequest
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
		if req.FilterCapabilityID != nil {
			capabilityID = *req.FilterCapabilityID
		}

		searchText := ""
		if req.FilterOrgDomain != nil {
			searchText = *req.FilterOrgDomain
		}

		var paginationKey pgtype.UUID
		if req.PaginationKey != nil {
			if err := paginationKey.Scan(*req.PaginationKey); err != nil {
				http.Error(w, "invalid pagination_key", http.StatusBadRequest)
				return
			}
		}

		// Admin views active listings from global catalog
		// For full visibility (draft/pending/suspended/archived), would need cross-region queries
		rows, err := s.Global.ListListingCatalogByCapability(ctx, globaldb.ListListingCatalogByCapabilityParams{
			CapabilityID:  capabilityID,
			PaginationKey: paginationKey,
			SearchText:    searchText,
			RowLimit:      limit + 1,
		})
		if err != nil {
			s.Logger(ctx).Error("failed to list listings", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var nextKey *string
		if int32(len(rows)) > limit {
			rows = rows[:limit]
			k := uuidToString(rows[len(rows)-1].ListingID)
			nextKey = &k
		}

		listings := make([]orgspec.MarketplaceListing, 0, len(rows))
		for _, row := range rows {
			listedAt := row.ListedAt.Time.Format(time.RFC3339)
			listings = append(listings, orgspec.MarketplaceListing{
				ListingID:             uuidToString(row.ListingID),
				OrgDomain:             row.OrgDomain,
				ListingNumber:         row.ListingNumber,
				Headline:              row.Headline,
				Description:           row.Description,
				Capabilities:          row.CapabilityIds,
				Status:                orgspec.MarketplaceListingStatusActive,
				ListedAt:              &listedAt,
				ActiveSubscriberCount: row.ActiveSubscriberCount,
				CreatedAt:             row.ListedAt.Time.Format(time.RFC3339),
				UpdatedAt:             row.UpdatedAt.Time.Format(time.RFC3339),
			})
		}

		json.NewEncoder(w).Encode(orgspec.AdminListListingsResponse{
			Listings:          listings,
			NextPaginationKey: nextKey,
		})
	}
}
