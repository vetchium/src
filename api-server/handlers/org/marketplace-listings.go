package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

const defaultListingLimit = 20
const maxListingLimit = 100

// ListMyListings handles POST /org/marketplace/listings/list
func ListMyListings(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.ListMyListingsRequest
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

		limit := int32(defaultListingLimit)
		if req.Limit != nil && *req.Limit > 0 {
			if int32(*req.Limit) < maxListingLimit {
				limit = int32(*req.Limit)
			} else {
				limit = maxListingLimit
			}
		}

		params := regionaldb.ListMarketplaceListingsByOrgParams{
			OrgID:      orgUser.OrgID,
			LimitCount: limit + 1,
		}
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			params.PaginationKey = parseListingUUID(*req.PaginationKey)
		}
		if req.CapabilityID != nil && *req.CapabilityID != "" {
			params.FilterCapabilityID = pgtype.Text{String: *req.CapabilityID, Valid: true}
		}

		rows, err := s.Regional.ListMarketplaceListingsByOrg(ctx, params)
		if err != nil {
			log.Error("failed to list listings", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(rows) > int(limit)
		if hasMore {
			rows = rows[:limit]
		}

		// Batch-fetch active subscriber counts from global subscription index.
		countByListingID := map[string]int32{}
		if len(rows) > 0 {
			listingUUIDs := make([]pgtype.UUID, 0, len(rows))
			for _, row := range rows {
				listingUUIDs = append(listingUUIDs, row.ListingID)
			}
			countRows, countErr := s.Global.CountActiveSubscriptionsByListings(ctx, listingUUIDs)
			if countErr != nil {
				log.Error("failed to count active subscriptions", "error", countErr)
			} else {
				for _, cr := range countRows {
					countByListingID[uuidToString(cr.ListingID)] = int32(cr.Count)
				}
			}
		}

		listings := make([]orgtypes.MarketplaceListing, 0, len(rows))
		for _, row := range rows {
			listings = append(listings, dbListingToAPI(row, countByListingID[uuidToString(row.ListingID)]))
		}

		var nextKey *string
		if hasMore && len(rows) > 0 {
			last := uuidToString(rows[len(rows)-1].ListingID)
			nextKey = &last
		}

		json.NewEncoder(w).Encode(orgtypes.ListMyListingsResponse{
			Listings:          listings,
			NextPaginationKey: nextKey,
		})
	}
}

// GetMyListing handles POST /org/marketplace/listings/get
// Only returns listings owned by the authenticated org.
func GetMyListing(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.GetMyListingRequest
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

		listing, err := s.Regional.GetMarketplaceListingByIDAndOrg(ctx, regionaldb.GetMarketplaceListingByIDAndOrgParams{
			ListingID: listingUUID,
			OrgID:     orgUser.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		count := int32(0)
		if countRows, countErr := s.Global.CountActiveSubscriptionsByListings(ctx, []pgtype.UUID{listingUUID}); countErr == nil && len(countRows) > 0 {
			count = int32(countRows[0].Count)
		}
		json.NewEncoder(w).Encode(dbListingToAPI(listing, count))
	}
}

// CreateListing handles POST /org/marketplace/listings/create
func CreateListing(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.CreateListingRequest
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

		// Verify the capability is active.
		_, err := s.Global.GetMarketplaceCapabilityByID(ctx, req.CapabilityID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get capability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get org's primary domain for the listing.
		domains, err := s.Global.GetGlobalOrgDomainsByOrg(ctx, orgUser.OrgID)
		if err != nil {
			log.Error("failed to get org domains", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		orgDomain := getOrgPrimaryDomain(domains)
		if orgDomain == "" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		var listing regionaldb.MarketplaceListing
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			listing, txErr = qtx.CreateMarketplaceListing(ctx, regionaldb.CreateMarketplaceListingParams{
				OrgID:        orgUser.OrgID,
				OrgDomain:    orgDomain,
				CapabilityID: req.CapabilityID,
				Headline:     req.Headline,
				Description:  req.Description,
			})
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_listing_created",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"listing_id":"` + uuidToString(listing.ListingID) + `","capability_id":"` + req.CapabilityID + `"}`),
			})
		})
		if err != nil {
			log.Error("failed to create listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(dbListingToAPI(listing, 0))
	}
}

// UpdateListing handles POST /org/marketplace/listings/update
// Only draft or active (non-suspended) listings can be updated.
func UpdateListing(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.UpdateListingRequest
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

		// Check listing exists and is owned by this org.
		existing, err := s.Regional.GetMarketplaceListingByIDAndOrg(ctx, regionaldb.GetMarketplaceListingByIDAndOrgParams{
			ListingID: listingUUID,
			OrgID:     orgUser.OrgID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Only draft or active listings can be updated (not suspended/archived).
		if existing.Status != regionaldb.MarketplaceListingStatusDraft &&
			existing.Status != regionaldb.MarketplaceListingStatusActive {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		var listing regionaldb.MarketplaceListing
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			listing, txErr = qtx.UpdateMarketplaceListing(ctx, regionaldb.UpdateMarketplaceListingParams{
				ListingID:   listingUUID,
				OrgID:       orgUser.OrgID,
				Headline:    req.Headline,
				Description: req.Description,
			})
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_listing_updated",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"listing_id":"` + req.ListingID + `"}`),
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to update listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// If active, update the global catalog with new content.
		if listing.Status == regionaldb.MarketplaceListingStatusActive {
			region := middleware.OrgRegionFromContext(ctx)
			if upsertErr := s.Global.UpsertListingCatalog(ctx, globaldb.UpsertListingCatalogParams{
				ListingID:    listing.ListingID,
				OrgGlobalID:  listing.OrgID,
				OrgDomain:    listing.OrgDomain,
				OrgRegion:    region,
				CapabilityID: listing.CapabilityID,
				Headline:     listing.Headline,
				Description:  listing.Description,
				ListedAt:     listing.ListedAt,
			}); upsertErr != nil {
				log.Error("CONSISTENCY_ALERT: failed to update listing catalog after update", "listing_id", req.ListingID, "error", upsertErr)
			}
		}

		json.NewEncoder(w).Encode(dbListingToAPI(listing, 0))
	}
}

// PublishListing handles POST /org/marketplace/listings/publish
// For org:superadmin: transitions draft → active (self-approval).
// For other org:manage_listings users: transitions draft → pending_review.
func PublishListing(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.PublishListingRequest
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

		// Determine if this user is a superadmin for self-approval.
		isSuperAdmin, err := s.Regional.IsOrgUserSuperAdmin(ctx, orgUser.OrgUserID)
		if err != nil {
			log.Error("failed to check superadmin status", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var listing regionaldb.MarketplaceListing
		if isSuperAdmin {
			// Superadmin: direct draft → active (self-approval).
			err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
				var txErr error
				listing, txErr = qtx.PublishMarketplaceListing(ctx, regionaldb.PublishMarketplaceListingParams{
					ListingID: listingUUID,
					OrgID:     orgUser.OrgID,
				})
				if txErr != nil {
					return txErr
				}
				return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
					EventType:   "org.marketplace_listing_published",
					ActorUserID: orgUser.OrgUserID,
					OrgID:       orgUser.OrgID,
					IpAddress:   audit.ExtractClientIP(r),
					EventData:   []byte(`{"listing_id":"` + req.ListingID + `"}`),
				})
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				log.Error("failed to publish listing", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			// Add to global catalog.
			region := middleware.OrgRegionFromContext(ctx)
			if upsertErr := s.Global.UpsertListingCatalog(ctx, globaldb.UpsertListingCatalogParams{
				ListingID:    listing.ListingID,
				OrgGlobalID:  listing.OrgID,
				OrgDomain:    listing.OrgDomain,
				OrgRegion:    region,
				CapabilityID: listing.CapabilityID,
				Headline:     listing.Headline,
				Description:  listing.Description,
				ListedAt:     listing.ListedAt,
			}); upsertErr != nil {
				log.Error("CONSISTENCY_ALERT: failed to add listing to global catalog after publish", "listing_id", req.ListingID, "error", upsertErr)
			}
		} else {
			// Non-superadmin: draft → pending_review (awaiting superadmin approval).
			err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
				var txErr error
				listing, txErr = qtx.SubmitMarketplaceListingForReview(ctx, regionaldb.SubmitMarketplaceListingForReviewParams{
					ListingID: listingUUID,
					OrgID:     orgUser.OrgID,
				})
				if txErr != nil {
					return txErr
				}
				return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
					EventType:   "org.marketplace_listing_submitted_for_review",
					ActorUserID: orgUser.OrgUserID,
					OrgID:       orgUser.OrgID,
					IpAddress:   audit.ExtractClientIP(r),
					EventData:   []byte(`{"listing_id":"` + req.ListingID + `"}`),
				})
			})
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					w.WriteHeader(http.StatusNotFound)
					return
				}
				log.Error("failed to submit listing for review", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
		}

		json.NewEncoder(w).Encode(dbListingToAPI(listing, 0))
	}
}

// ApproveListing handles POST /org/marketplace/listings/approve
// Only org:superadmin may approve. Transitions pending_review → active.
func ApproveListing(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.ApproveListingRequest
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

		var listing regionaldb.MarketplaceListing
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			listing, txErr = qtx.ApproveMarketplaceListing(ctx, regionaldb.ApproveMarketplaceListingParams{
				ListingID: listingUUID,
				OrgID:     orgUser.OrgID,
			})
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_listing_approved",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"listing_id":"` + req.ListingID + `"}`),
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to approve listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Add to global catalog.
		region := middleware.OrgRegionFromContext(ctx)
		if upsertErr := s.Global.UpsertListingCatalog(ctx, globaldb.UpsertListingCatalogParams{
			ListingID:    listing.ListingID,
			OrgGlobalID:  listing.OrgID,
			OrgDomain:    listing.OrgDomain,
			OrgRegion:    region,
			CapabilityID: listing.CapabilityID,
			Headline:     listing.Headline,
			Description:  listing.Description,
			ListedAt:     listing.ListedAt,
		}); upsertErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to add listing to global catalog after approval", "listing_id", req.ListingID, "error", upsertErr)
		}

		json.NewEncoder(w).Encode(dbListingToAPI(listing, 0))
	}
}

// RejectListing handles POST /org/marketplace/listings/reject
// Only org:superadmin may reject. Transitions pending_review → draft with a rejection_note.
func RejectListing(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.RejectListingRequest
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

		var listing regionaldb.MarketplaceListing
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			listing, txErr = qtx.RejectMarketplaceListing(ctx, regionaldb.RejectMarketplaceListingParams{
				ListingID:     listingUUID,
				OrgID:         orgUser.OrgID,
				RejectionNote: pgtype.Text{String: req.RejectionNote, Valid: true},
			})
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_listing_rejected",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"listing_id":"` + req.ListingID + `"}`),
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to reject listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(dbListingToAPI(listing, 0))
	}
}

// ArchiveListing handles POST /org/marketplace/listings/archive
// Transitions an active listing to archived and removes it from the global catalog.
func ArchiveListing(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.ArchiveListingRequest
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

		var listing regionaldb.MarketplaceListing
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			listing, txErr = qtx.ArchiveMarketplaceListing(ctx, regionaldb.ArchiveMarketplaceListingParams{
				ListingID: listingUUID,
				OrgID:     orgUser.OrgID,
			})
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_listing_archived",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"listing_id":"` + req.ListingID + `"}`),
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to archive listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Remove from global catalog.
		if delErr := s.Global.DeleteListingCatalog(ctx, listingUUID); delErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to remove archived listing from catalog", "listing_id", req.ListingID, "error", delErr)
		}

		json.NewEncoder(w).Encode(dbListingToAPI(listing, 0))
	}
}

// ReopenListing handles POST /org/marketplace/listings/reopen
// Transitions an archived listing back to draft state (archived → draft).
func ReopenListing(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.ReopenListingRequest
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

		var listing regionaldb.MarketplaceListing
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			listing, txErr = qtx.ReopenMarketplaceListing(ctx, regionaldb.ReopenMarketplaceListingParams{
				ListingID: listingUUID,
				OrgID:     orgUser.OrgID,
			})
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_listing_reopened",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"listing_id":"` + req.ListingID + `"}`),
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to reopen listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(dbListingToAPI(listing, 0))
	}
}
