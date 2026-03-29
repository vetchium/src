package org

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

const (
	defaultServiceListingLimit = 20
	maxServiceListingLimit     = 100
)

// ListMarketplaceServiceListings handles POST /org/list-marketplace-service-listings
// Returns the provider's own listings.
func ListMarketplaceServiceListings(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.ListMarketplaceServiceListingsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		limit := defaultServiceListingLimit
		if req.Limit != nil {
			limit = *req.Limit
			if limit > maxServiceListingLimit {
				limit = maxServiceListingLimit
			}
			if limit <= 0 {
				limit = defaultServiceListingLimit
			}
		}

		var cursorCreatedAt pgtype.Timestamptz
		var cursorID pgtype.UUID

		if req.Cursor != nil && *req.Cursor != "" {
			ca, id, err := decodeServiceListingCursor(*req.Cursor)
			if err != nil {
				log.Debug("invalid cursor", "error", err)
				http.Error(w, "invalid cursor format", http.StatusBadRequest)
				return
			}
			cursorCreatedAt = pgtype.Timestamptz{Time: ca, Valid: true}
			if err := cursorID.Scan(id); err != nil {
				log.Debug("invalid cursor id", "error", err)
				http.Error(w, "invalid cursor format", http.StatusBadRequest)
				return
			}
		}

		var filterState regionaldb.NullServiceListingState
		if req.FilterState != nil {
			filterState = regionaldb.NullServiceListingState{
				ServiceListingState: regionaldb.ServiceListingState(*req.FilterState),
				Valid:               true,
			}
		}

		listings, err := s.Regional.ListProviderServiceListings(ctx, regionaldb.ListProviderServiceListingsParams{
			OrgID:           orgUser.OrgID,
			FilterState:     filterState,
			CursorCreatedAt: cursorCreatedAt,
			CursorID:        cursorID,
			LimitCount:      int32(limit + 1),
		})
		if err != nil {
			log.Error("failed to list service listings", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(listings) > limit
		if hasMore {
			listings = listings[:limit]
		}

		// Get the org's primary domain from global DB for the response
		domains, err := s.Global.GetGlobalOrgDomainsByOrg(ctx, orgUser.OrgID)
		if err != nil || len(domains) == 0 {
			log.Error("failed to get org domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		orgDomain := domains[0].Domain

		items := make([]orgtypes.ServiceListing, 0, len(listings))
		for _, l := range listings {
			items = append(items, dbServiceListingToAPI(l, orgDomain))
		}

		var nextCursor *string
		if hasMore && len(listings) > 0 {
			last := listings[len(listings)-1]
			if last.CreatedAt.Valid {
				c := encodeServiceListingCursor(last.CreatedAt.Time, last.ServiceListingID)
				nextCursor = &c
			}
		}

		json.NewEncoder(w).Encode(orgtypes.ListMarketplaceServiceListingsResponse{
			ServiceListings: items,
			NextCursor:      nextCursor,
		})
	}
}
