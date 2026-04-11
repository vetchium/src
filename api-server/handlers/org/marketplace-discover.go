package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

const defaultDiscoverLimit = 20
const maxDiscoverLimit = 100

// DiscoverListings handles POST /org/marketplace/discover/list
// Returns active listings from the global catalog (browse view for buyers).
func DiscoverListings(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.DiscoverListingsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		limit := int32(defaultDiscoverLimit)
		if req.Limit != nil && *req.Limit > 0 {
			if int32(*req.Limit) < maxDiscoverLimit {
				limit = int32(*req.Limit)
			} else {
				limit = maxDiscoverLimit
			}
		}

		params := globaldb.ListListingCatalogParams{
			LimitCount: limit + 1,
		}
		if req.CapabilityID != nil && *req.CapabilityID != "" {
			params.FilterCapabilityID = pgtype.Text{String: *req.CapabilityID, Valid: true}
		}
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			params.PaginationKey = parseListingUUID(*req.PaginationKey)
		}

		rows, err := s.Global.ListListingCatalog(ctx, params)
		if err != nil {
			log.Error("failed to list catalog", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(rows) > int(limit)
		if hasMore {
			rows = rows[:limit]
		}

		cards := make([]orgtypes.MarketplaceListingCard, 0, len(rows))
		for _, row := range rows {
			cards = append(cards, dbCatalogToCard(row))
		}

		var nextKey *string
		if hasMore && len(rows) > 0 {
			last := uuidToString(rows[len(rows)-1].ListingID)
			nextKey = &last
		}

		json.NewEncoder(w).Encode(orgtypes.DiscoverListingsResponse{
			Listings:          cards,
			NextPaginationKey: nextKey,
		})
	}
}

// GetDiscoverListing handles POST /org/marketplace/discover/get
// Returns a specific listing from the global catalog (public browse view).
func GetDiscoverListing(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.GetListingRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		listingUUID := parseListingUUID(req.ListingID)
		if !listingUUID.Valid {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		entry, err := s.Global.GetListingCatalogEntry(ctx, listingUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get catalog entry", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(dbCatalogToCard(entry))
	}
}
