package admin

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	admintypes "vetchium-api-server.typespec/admin"
)

const defaultAdminListingLimit = 50
const maxAdminListingLimit = 200

// AdminListListings handles POST /admin/marketplace/listings/list
// Queries all regional DBs and merges results sorted by listing_id.
func AdminListListings(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminListListingsRequest
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

		limit := int32(defaultAdminListingLimit)
		if req.Limit != nil && *req.Limit > 0 {
			if int32(*req.Limit) < maxAdminListingLimit {
				limit = int32(*req.Limit)
			} else {
				limit = maxAdminListingLimit
			}
		}

		// Resolve optional org domain filter to org UUID.
		var filterOrgID pgtype.UUID
		if req.OrgDomain != nil && *req.OrgDomain != "" {
			orgEntry, err := s.Global.GetOrgByDomain(ctx, *req.OrgDomain)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					json.NewEncoder(w).Encode(admintypes.AdminListListingsResponse{
						Listings: []admintypes.AdminMarketplaceListing{},
					})
					return
				}
				log.Error("failed to get org by domain", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			filterOrgID = orgEntry.OrgID
		}

		var filterCapID pgtype.Text
		if req.CapabilityID != nil && *req.CapabilityID != "" {
			filterCapID = pgtype.Text{String: *req.CapabilityID, Valid: true}
		}

		var filterStatus regionaldb.NullMarketplaceListingStatus
		if req.FilterStatus != nil {
			filterStatus = regionaldb.NullMarketplaceListingStatus{
				MarketplaceListingStatus: regionaldb.MarketplaceListingStatus(*req.FilterStatus),
				Valid:                    true,
			}
		}

		var paginationKey pgtype.UUID
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			paginationKey = parseUUID(*req.PaginationKey)
		}

		var all []regionaldb.MarketplaceListing
		for _, region := range s.AllRegions() {
			rdb := s.GetRegionalDB(region)
			if rdb == nil {
				continue
			}
			rows, err := rdb.ListAllMarketplaceListings(ctx, regionaldb.ListAllMarketplaceListingsParams{
				FilterCapabilityID: filterCapID,
				FilterOrgID:        filterOrgID,
				FilterStatus:       filterStatus,
				PaginationKey:      paginationKey,
				LimitCount:         limit + 1,
			})
			if err != nil {
				log.Error("failed to list listings in region", "region", region, "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			all = append(all, rows...)
		}

		// Sort by listing_id UUID string for stable global ordering.
		sort.Slice(all, func(i, j int) bool {
			return uuidToString(all[i].ListingID) < uuidToString(all[j].ListingID)
		})

		hasMore := len(all) > int(limit)
		if hasMore {
			all = all[:limit]
		}

		listings := make([]admintypes.AdminMarketplaceListing, 0, len(all))
		for _, l := range all {
			listings = append(listings, adminListingToAPI(l))
		}

		var nextKey *string
		if hasMore && len(all) > 0 {
			last := uuidToString(all[len(all)-1].ListingID)
			nextKey = &last
		}

		json.NewEncoder(w).Encode(admintypes.AdminListListingsResponse{
			Listings:          listings,
			NextPaginationKey: nextKey,
		})
	}
}

// AdminGetListing handles POST /admin/marketplace/listings/get
// Looks up the listing's region from the global listing catalog, then fetches from that region.
func AdminGetListing(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminGetListingRequest
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

		listingUUID := parseUUID(req.ListingID)
		if !listingUUID.Valid {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Look up the listing's region from the global catalog.
		catalogEntry, err := s.Global.GetListingCatalogEntry(ctx, listingUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// Not in catalog — try all regions (could be a draft listing).
				for _, region := range s.AllRegions() {
					rdb := s.GetRegionalDB(region)
					if rdb == nil {
						continue
					}
					listing, rErr := rdb.GetMarketplaceListingByID(ctx, listingUUID)
					if rErr == nil {
						json.NewEncoder(w).Encode(adminListingToAPI(listing))
						return
					}
					if !errors.Is(rErr, pgx.ErrNoRows) {
						log.Error("failed to get listing from region", "region", region, "error", rErr)
						http.Error(w, "", http.StatusInternalServerError)
						return
					}
				}
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get listing catalog entry", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		rdb := s.GetRegionalDB(globaldb.Region(catalogEntry.OrgRegion))
		if rdb == nil {
			log.Error("unknown region for listing", "region", catalogEntry.OrgRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		listing, err := rdb.GetMarketplaceListingByID(ctx, listingUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(adminListingToAPI(listing))
	}
}

// AdminSuspendListing handles POST /admin/marketplace/listings/suspend
// Suspends an active listing and removes it from the global catalog.
func AdminSuspendListing(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminSuspendListingRequest
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

		listingUUID := parseUUID(req.ListingID)
		if !listingUUID.Valid {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Look up the listing's region from the global catalog.
		catalogEntry, err := s.Global.GetListingCatalogEntry(ctx, listingUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get listing catalog entry", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		region := globaldb.Region(catalogEntry.OrgRegion)
		var listing regionaldb.MarketplaceListing
		err = s.WithRegionalTx(ctx, region, func(qtx *regionaldb.Queries) error {
			var txErr error
			listing, txErr = qtx.AdminSuspendMarketplaceListing(ctx, regionaldb.AdminSuspendMarketplaceListingParams{
				ListingID:      listingUUID,
				SuspensionNote: pgtype.Text{String: req.SuspensionNote, Valid: true},
			})
			return txErr
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to suspend listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Remove from global catalog.
		if delErr := s.Global.DeleteListingCatalog(ctx, listingUUID); delErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to remove suspended listing from catalog", "listing_id", req.ListingID, "error", delErr)
		}

		// Write admin audit log.
		if auditErr := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.marketplace_listing_suspended",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"listing_id":"` + req.ListingID + `"}`),
			})
		}); auditErr != nil {
			log.Error("failed to write audit log", "error", auditErr)
		}

		json.NewEncoder(w).Encode(adminListingToAPI(listing))
	}
}

// AdminApproveListing handles POST /admin/marketplace/listings/approve
// Approves a draft listing by transitioning it to active and adding it to the global catalog.
func AdminApproveListing(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminApproveListingRequest
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

		listingUUID := parseUUID(req.ListingID)
		if !listingUUID.Valid {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Draft listings are not in the global catalog, so search all regions.
		var listing regionaldb.MarketplaceListing
		var foundRegion globaldb.Region
		for _, region := range s.AllRegions() {
			rdb := s.GetRegionalDB(region)
			if rdb == nil {
				continue
			}
			l, err := rdb.GetMarketplaceListingByID(ctx, listingUUID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					continue
				}
				log.Error("failed to search listing in region", "region", region, "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			listing = l
			foundRegion = region
			break
		}
		if foundRegion == "" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if listing.Status != regionaldb.MarketplaceListingStatusDraft {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Approve in regional DB.
		err := s.WithRegionalTx(ctx, foundRegion, func(qtx *regionaldb.Queries) error {
			var txErr error
			listing, txErr = qtx.AdminApproveMarketplaceListing(ctx, listingUUID)
			return txErr
		})
		if err != nil {
			log.Error("failed to approve listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Add to global catalog.
		upsertErr := s.Global.UpsertListingCatalog(ctx, globaldb.UpsertListingCatalogParams{
			ListingID:    listing.ListingID,
			OrgGlobalID:  listing.OrgID,
			OrgDomain:    listing.OrgDomain,
			OrgRegion:    string(foundRegion),
			CapabilityID: listing.CapabilityID,
			Headline:     listing.Headline,
			Description:  listing.Description,
			ListedAt:     listing.ListedAt,
		})
		if upsertErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to add approved listing to global catalog", "listing_id", req.ListingID, "error", upsertErr)
		}

		// Write admin audit log.
		if auditErr := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.marketplace_listing_approved",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"listing_id":"` + req.ListingID + `"}`),
			})
		}); auditErr != nil {
			log.Error("failed to write audit log", "error", auditErr)
		}

		json.NewEncoder(w).Encode(adminListingToAPI(listing))
	}
}

// AdminReinstateListing handles POST /admin/marketplace/listings/reinstate
// Reinstates a suspended listing and adds it back to the global catalog.
func AdminReinstateListing(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminReinstateListingRequest
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

		listingUUID := parseUUID(req.ListingID)
		if !listingUUID.Valid {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// To reinstate, we need to know the region. Search all regions since the listing
		// was removed from the catalog on suspend.
		var listing regionaldb.MarketplaceListing
		var foundRegion globaldb.Region
		for _, region := range s.AllRegions() {
			rdb := s.GetRegionalDB(region)
			if rdb == nil {
				continue
			}
			l, err := rdb.GetMarketplaceListingByID(ctx, listingUUID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					continue
				}
				log.Error("failed to search listing in region", "region", region, "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			listing = l
			foundRegion = region
			break
		}
		if foundRegion == "" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if listing.Status != regionaldb.MarketplaceListingStatusSuspended {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Reinstate in regional DB.
		err := s.WithRegionalTx(ctx, foundRegion, func(qtx *regionaldb.Queries) error {
			var txErr error
			listing, txErr = qtx.AdminReinstateMarketplaceListing(ctx, listingUUID)
			return txErr
		})
		if err != nil {
			log.Error("failed to reinstate listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Add back to global catalog.
		upsertErr := s.Global.UpsertListingCatalog(ctx, globaldb.UpsertListingCatalogParams{
			ListingID:    listing.ListingID,
			OrgGlobalID:  listing.OrgID,
			OrgDomain:    listing.OrgDomain,
			OrgRegion:    string(foundRegion),
			CapabilityID: listing.CapabilityID,
			Headline:     listing.Headline,
			Description:  listing.Description,
			ListedAt:     listing.ListedAt,
		})
		if upsertErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to add reinstated listing back to catalog", "listing_id", req.ListingID, "error", upsertErr)
		}

		// Write admin audit log.
		if auditErr := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.marketplace_listing_reinstated",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"listing_id":"` + req.ListingID + `"}`),
			})
		}); auditErr != nil {
			log.Error("failed to write audit log", "error", auditErr)
		}

		json.NewEncoder(w).Encode(adminListingToAPI(listing))
	}
}
