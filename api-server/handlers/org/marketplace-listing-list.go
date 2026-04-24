package org

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

func ListMyListings(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.ListMyListingsRequest
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

		var filterStatus regionaldb.NullMarketplaceListingStatus
		if req.FilterStatus != nil {
			filterStatus = regionaldb.NullMarketplaceListingStatus{
				MarketplaceListingStatus: regionaldb.MarketplaceListingStatus(*req.FilterStatus),
				Valid:                    true,
			}
		}

		var paginationKey pgtype.UUID
		if req.PaginationKey != nil {
			if err := paginationKey.Scan(*req.PaginationKey); err != nil {
				http.Error(w, "invalid pagination_key", http.StatusBadRequest)
				return
			}
		}

		rows, err := s.Regional.ListMarketplaceListingsByOrg(ctx, regionaldb.ListMarketplaceListingsByOrgParams{
			OrgID:         orgUser.OrgID,
			FilterStatus:  filterStatus,
			PaginationKey: paginationKey,
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
			resp := orgspec.MarketplaceListing{
				ListingID:             uuidToString(row.ListingID),
				OrgDomain:             row.OrgDomain,
				ListingNumber:         row.ListingNumber,
				Headline:              row.Headline,
				Description:           row.Description,
				Capabilities:          row.Capabilities,
				Status:                orgspec.MarketplaceListingStatus(row.Status),
				ActiveSubscriberCount: row.ActiveSubscriberCount,
				CreatedAt:             row.CreatedAt.Time.Format(time.RFC3339),
				UpdatedAt:             row.UpdatedAt.Time.Format(time.RFC3339),
			}
			if row.SuspensionNote.Valid {
				resp.SuspensionNote = &row.SuspensionNote.String
			}
			if row.RejectionNote.Valid {
				resp.RejectionNote = &row.RejectionNote.String
			}
			if row.ListedAt.Valid {
				t := row.ListedAt.Time.Format(time.RFC3339)
				resp.ListedAt = &t
			}
			listings = append(listings, resp)
		}

		json.NewEncoder(w).Encode(orgspec.ListMyListingsResponse{
			Listings:          listings,
			NextPaginationKey: nextKey,
		})
	}
}
