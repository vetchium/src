package admin

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	admintypes "vetchium-api-server.typespec/admin"
	orgtypes "vetchium-api-server.typespec/org"
)

// AdminListMarketplaceServiceListings handles POST /admin/list-marketplace-service-listings
func AdminListMarketplaceServiceListings(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			log.Debug("admin user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminListMarketplaceServiceListingsRequest
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

		limit := 20
		if req.Limit != nil && *req.Limit > 0 {
			limit = *req.Limit
			if limit > 50 {
				limit = 50
			}
		}

		// Build filter params
		var filterState regionaldb.NullServiceListingState
		if req.FilterState != nil {
			filterState = regionaldb.NullServiceListingState{
				ServiceListingState: regionaldb.ServiceListingState(*req.FilterState),
				Valid:               true,
			}
		}

		var filterOrgID pgtype.UUID
		if req.FilterOrgDomain != nil && *req.FilterOrgDomain != "" {
			org, err := s.Global.GetOrgByDomain(ctx, *req.FilterOrgDomain)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				log.Error("failed to get org by domain", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			filterOrgID = org.OrgID
		}

		hasReports := pgtype.Bool{Bool: false, Valid: false}
		if req.HasReports != nil {
			hasReports = pgtype.Bool{Bool: *req.HasReports, Valid: true}
		}

		// Fan out to all regions (TODO: full cross-region cursor support)
		var allListings []regionaldb.MarketplaceServiceListing
		for _, region := range s.AllRegions() {
			rdb := s.GetRegionalDB(region)
			if rdb == nil {
				continue
			}
			listings, err := rdb.AdminListServiceListings(ctx, regionaldb.AdminListServiceListingsParams{
				FilterState:     filterState,
				FilterOrgID:     filterOrgID,
				HasReports:      hasReports,
				CursorCreatedAt: pgtype.Timestamptz{},
				CursorID:        pgtype.UUID{},
				LimitCount:      100,
			})
			if err != nil {
				log.Error("failed to list service listings from region", "region", region, "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			allListings = append(allListings, listings...)
		}

		// Sort merged results by (created_at DESC, service_listing_id DESC)
		sort.Slice(allListings, func(i, j int) bool {
			ti := allListings[i].CreatedAt.Time
			tj := allListings[j].CreatedAt.Time
			if !ti.Equal(tj) {
				return ti.After(tj)
			}
			for k := 15; k >= 0; k-- {
				if allListings[i].ServiceListingID.Bytes[k] != allListings[j].ServiceListingID.Bytes[k] {
					return allListings[i].ServiceListingID.Bytes[k] > allListings[j].ServiceListingID.Bytes[k]
				}
			}
			return false
		})

		// Apply limit + detect next cursor
		var nextCursor *string
		if len(allListings) > limit {
			last := allListings[limit-1]
			cursor := encodeAdminServiceListingCursor(last.CreatedAt.Time, last.ServiceListingID)
			nextCursor = &cursor
			allListings = allListings[:limit]
		}

		// Build orgID→domain map for all listings
		orgDomainMap := make(map[[16]byte]string)
		for _, sl := range allListings {
			key := sl.OrgID.Bytes
			if _, ok := orgDomainMap[key]; !ok {
				domains, err := s.Global.GetGlobalOrgDomainsByOrg(ctx, sl.OrgID)
				if err != nil || len(domains) == 0 {
					orgDomainMap[key] = ""
				} else {
					orgDomainMap[key] = domains[0].Domain
				}
			}
		}

		serviceListings := make([]orgtypes.ServiceListing, 0, len(allListings))
		for _, sl := range allListings {
			domain := orgDomainMap[sl.OrgID.Bytes]
			serviceListings = append(serviceListings, adminDbServiceListingToAPI(sl, domain))
		}

		resp := admintypes.AdminListMarketplaceServiceListingsResponse{
			ServiceListings: serviceListings,
			NextCursor:      nextCursor,
		}
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}
