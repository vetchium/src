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
	defaultBrowseLimit = 20
	maxBrowseLimit     = 50
)

// BrowseMarketplaceServiceListings handles POST /org/browse-marketplace-service-listings
// Returns active service listings visible to any authenticated org user (buyer view).
//
// TODO: Full multi-region federation — currently queries only the local region.
// For cross-region support, fan out to all regions via s.InternalEndpoints,
// merge results, and re-paginate by (created_at DESC, service_listing_id DESC).
func BrowseMarketplaceServiceListings(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.BrowseMarketplaceServiceListingsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		limit := defaultBrowseLimit
		if req.Limit != nil {
			limit = *req.Limit
			if limit > maxBrowseLimit {
				limit = maxBrowseLimit
			}
			if limit <= 0 {
				limit = defaultBrowseLimit
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

		// Build filter arrays (nil slice means no filter)
		var keyword pgtype.Text
		if req.Keyword != nil && *req.Keyword != "" {
			keyword = pgtype.Text{String: *req.Keyword, Valid: true}
		}

		var serviceCategory regionaldb.NullServiceCategory
		if req.ServiceCategory != nil {
			serviceCategory = regionaldb.NullServiceCategory{
				ServiceCategory: regionaldb.ServiceCategory(*req.ServiceCategory),
				Valid:           true,
			}
		}

		industries := stringSlice(req.Industries, func(v orgtypes.Industry) string { return string(v) })
		companySizes := stringSlice(req.CompanySizes, func(v orgtypes.CompanySize) string { return string(v) })
		jobFunctions := stringSlice(req.JobFunctions, func(v orgtypes.JobFunction) string { return string(v) })
		seniorityLevels := stringSlice(req.SeniorityLevels, func(v orgtypes.SeniorityLevel) string { return string(v) })

		params := regionaldb.BrowseActiveServiceListingsParams{
			Keyword:                   keyword,
			ServiceCategory:           serviceCategory,
			Industries:                industries,
			CompanySizes:              companySizes,
			JobFunctions:              jobFunctions,
			SeniorityLevels:           seniorityLevels,
			CountriesOfService:        req.CountriesOfService,
			GeographicSourcingRegions: req.GeographicSourcingRegions,
			CursorCreatedAt:           cursorCreatedAt,
			CursorID:                  cursorID,
			LimitCount:                int32(limit + 1),
		}

		rows, err := s.Regional.BrowseActiveServiceListings(ctx, params)
		if err != nil {
			log.Error("failed to browse service listings", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(rows) > limit
		if hasMore {
			rows = rows[:limit]
		}

		// Build a cache of org_id -> primary domain for efficient lookup
		orgDomainCache := make(map[pgtype.UUID]string)
		items := make([]orgtypes.ServiceListingSummary, 0, len(rows))
		for _, row := range rows {
			orgDomain, ok := orgDomainCache[row.OrgID]
			if !ok {
				domains, domErr := s.Global.GetGlobalOrgDomainsByOrg(ctx, row.OrgID)
				if domErr != nil || len(domains) == 0 {
					log.Error("failed to get org domain for browse result", "error", domErr)
					http.Error(w, "", http.StatusInternalServerError)
					return
				}
				orgDomain = domains[0].Domain
				orgDomainCache[row.OrgID] = orgDomain
			}
			items = append(items, dbBrowseRowToSummary(row, orgDomain))
		}

		var nextCursor *string
		if hasMore && len(rows) > 0 {
			last := rows[len(rows)-1]
			if last.CreatedAt.Valid {
				c := encodeServiceListingCursor(last.CreatedAt.Time, last.ServiceListingID)
				nextCursor = &c
			}
		}

		json.NewEncoder(w).Encode(orgtypes.BrowseMarketplaceServiceListingsResponse{
			ServiceListings: items,
			NextCursor:      nextCursor,
		})
	}
}

// stringSlice converts a typed slice to []string using the provided converter function.
// Returns nil if input is empty so DB queries treat it as "no filter".
func stringSlice[T any](in []T, fn func(T) string) []string {
	if len(in) == 0 {
		return nil
	}
	out := make([]string, len(in))
	for i, v := range in {
		out[i] = fn(v)
	}
	return out
}
