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

const defaultAdminOfferLimit = 50
const maxAdminOfferLimit = 200

// AdminListOffers handles POST /admin/marketplace/provider-offers/list
// Iterates over all regional DBs and merges results.
func AdminListOffers(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.AdminListOffersRequest
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

		limit := int32(defaultAdminOfferLimit)
		if req.Limit != nil && *req.Limit > 0 {
			if int32(*req.Limit) < maxAdminOfferLimit {
				limit = int32(*req.Limit)
			} else {
				limit = maxAdminOfferLimit
			}
		}

		// Resolve optional org domain filter to org UUID.
		var filterOrgID pgtype.UUID
		var filterOrgDomain string
		if req.FilterOrgDomain != nil && *req.FilterOrgDomain != "" {
			filterOrgDomain = *req.FilterOrgDomain
			org, err := s.Global.GetOrgByDomain(ctx, filterOrgDomain)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					resp := admintypes.AdminListOffersResponse{
						Offers: []admintypes.AdminMarketplaceOffer{},
					}
					json.NewEncoder(w).Encode(resp)
					return
				}
				log.Error("failed to get org by domain", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			filterOrgID = org.OrgID
		}

		var filterStatus regionaldb.NullMarketplaceOfferStatus
		if req.FilterStatus != nil && *req.FilterStatus != "" {
			filterStatus = regionaldb.NullMarketplaceOfferStatus{
				MarketplaceOfferStatus: regionaldb.MarketplaceOfferStatus(*req.FilterStatus),
				Valid:                  true,
			}
		}

		type offerItem struct {
			domain string
			offer  regionaldb.MarketplaceOffer
		}

		var all []offerItem

		for _, region := range s.AllRegions() {
			rdb := s.GetRegionalDB(region)
			if rdb == nil {
				continue
			}
			rows, err := rdb.ListMarketplaceOffers(ctx, regionaldb.ListMarketplaceOffersParams{
				FilterStatus: filterStatus,
				FilterOrgID:  filterOrgID,
				LimitCount:   limit + 1,
			})
			if err != nil {
				log.Error("failed to list offers in region", "region", region, "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			for _, o := range rows {
				// Filter by capability slug if requested (ListMarketplaceOffers doesn't filter by it).
				if req.FilterCapabilitySlug != nil && *req.FilterCapabilitySlug != "" {
					if o.CapabilitySlug != *req.FilterCapabilitySlug {
						continue
					}
				}
				orgDomain := ""
				if filterOrgDomain != "" {
					orgDomain = filterOrgDomain
				} else {
					domains, domErr := s.Global.GetGlobalOrgDomainsByOrg(ctx, o.OrgID)
					if domErr == nil && len(domains) > 0 {
						orgDomain = domains[0].Domain
					}
				}
				all = append(all, offerItem{domain: orgDomain, offer: o})
			}
		}

		// Sort by updated_at desc, capability_slug.
		sort.Slice(all, func(i, j int) bool {
			ti := all[i].offer.UpdatedAt.Time
			tj := all[j].offer.UpdatedAt.Time
			if !ti.Equal(tj) {
				return ti.After(tj)
			}
			return all[i].offer.CapabilitySlug < all[j].offer.CapabilitySlug
		})

		hasMore := len(all) > int(limit)
		if hasMore {
			all = all[:limit]
		}

		offers := make([]admintypes.AdminMarketplaceOffer, 0, len(all))
		for _, item := range all {
			offers = append(offers, adminOfferToAPI(item.domain, item.offer))
		}

		var nextKey *string
		if hasMore && len(all) > 0 {
			last := all[len(all)-1]
			k := last.offer.CapabilitySlug
			nextKey = &k
		}

		resp := admintypes.AdminListOffersResponse{
			Offers:            offers,
			NextPaginationKey: nextKey,
		}
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// AdminGetOffer handles POST /admin/marketplace/provider-offers/get
func AdminGetOffer(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.AdminGetOfferRequest
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

		org, err := s.Global.GetOrgByDomain(ctx, req.OrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get org by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		rdb := s.GetRegionalDB(org.Region)
		if rdb == nil {
			log.Error("no regional DB for org region", "region", org.Region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		offer, err := rdb.GetMarketplaceOfferByOrgAndCapability(ctx,
			regionaldb.GetMarketplaceOfferByOrgAndCapabilityParams{
				OrgID:          org.OrgID,
				CapabilitySlug: req.CapabilitySlug,
			})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get offer", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if err := json.NewEncoder(w).Encode(adminOfferToAPI(req.OrgDomain, offer)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// AdminApproveOffer handles POST /admin/marketplace/provider-offers/approve
// After approval, upserts the global offer catalog as a compensating write.
func AdminApproveOffer(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.AdminApproveOfferRequest
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

		org, err := s.Global.GetOrgByDomain(ctx, req.OrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get org by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var offer regionaldb.MarketplaceOffer
		err = s.WithRegionalTx(ctx, org.Region, func(qtx *regionaldb.Queries) error {
			var txErr error
			offer, txErr = qtx.AdminApproveMarketplaceOffer(ctx,
				regionaldb.AdminApproveMarketplaceOfferParams{
					OrgID:          org.OrgID,
					CapabilitySlug: req.CapabilitySlug,
					ReviewNote:     optionalText(req.ReviewNote),
				})
			return txErr
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to approve offer", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Write admin audit log to global DB.
		if auditErr := s.Global.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
			EventType:   "admin.marketplace_offer_approved",
			ActorUserID: adminUser.AdminUserID,
			IpAddress:   audit.ExtractClientIP(r),
			EventData:   []byte(`{"org_domain":"` + req.OrgDomain + `","capability_slug":"` + req.CapabilitySlug + `"}`),
		}); auditErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to write admin audit log", "error", auditErr)
		}

		// Upsert global offer catalog as compensating write.
		catalogParams := globaldb.UpsertMarketplaceOfferCatalogParams{
			ProviderOrgGlobalID: org.OrgID,
			ProviderOrgDomain:   req.OrgDomain,
			ProviderRegion:      string(org.Region),
			CapabilitySlug:      offer.CapabilitySlug,
			Headline:            offer.Headline,
			Summary:             offer.Summary,
			RegionsServed:       offer.RegionsServed,
			PricingHint:         offer.PricingHint,
			ContactMode:         offer.ContactMode,
			ContactValue:        offer.ContactValue,
			Status:              string(offer.Status),
		}
		if _, catalogErr := s.Global.UpsertMarketplaceOfferCatalog(ctx, catalogParams); catalogErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to upsert offer catalog after admin approval", "error", catalogErr)
		}

		if err := json.NewEncoder(w).Encode(adminOfferToAPI(req.OrgDomain, offer)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// AdminRejectOffer handles POST /admin/marketplace/provider-offers/reject
func AdminRejectOffer(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.AdminRejectOfferRequest
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

		org, err := s.Global.GetOrgByDomain(ctx, req.OrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get org by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var offer regionaldb.MarketplaceOffer
		err = s.WithRegionalTx(ctx, org.Region, func(qtx *regionaldb.Queries) error {
			var txErr error
			offer, txErr = qtx.AdminRejectMarketplaceOffer(ctx,
				regionaldb.AdminRejectMarketplaceOfferParams{
					OrgID:          org.OrgID,
					CapabilitySlug: req.CapabilitySlug,
					ReviewNote:     pgtype.Text{String: req.ReviewNote, Valid: true},
				})
			return txErr
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to reject offer", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if auditErr := s.Global.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
			EventType:   "admin.marketplace_offer_rejected",
			ActorUserID: adminUser.AdminUserID,
			IpAddress:   audit.ExtractClientIP(r),
			EventData:   []byte(`{"org_domain":"` + req.OrgDomain + `","capability_slug":"` + req.CapabilitySlug + `"}`),
		}); auditErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to write admin audit log", "error", auditErr)
		}

		if err := json.NewEncoder(w).Encode(adminOfferToAPI(req.OrgDomain, offer)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// AdminSuspendOffer handles POST /admin/marketplace/provider-offers/suspend
func AdminSuspendOffer(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.AdminSuspendOfferRequest
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

		org, err := s.Global.GetOrgByDomain(ctx, req.OrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get org by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var offer regionaldb.MarketplaceOffer
		err = s.WithRegionalTx(ctx, org.Region, func(qtx *regionaldb.Queries) error {
			var txErr error
			offer, txErr = qtx.AdminSuspendMarketplaceOffer(ctx,
				regionaldb.AdminSuspendMarketplaceOfferParams{
					OrgID:          org.OrgID,
					CapabilitySlug: req.CapabilitySlug,
					ReviewNote:     pgtype.Text{String: req.ReviewNote, Valid: true},
				})
			return txErr
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to suspend offer", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if auditErr := s.Global.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
			EventType:   "admin.marketplace_offer_suspended",
			ActorUserID: adminUser.AdminUserID,
			IpAddress:   audit.ExtractClientIP(r),
			EventData:   []byte(`{"org_domain":"` + req.OrgDomain + `","capability_slug":"` + req.CapabilitySlug + `"}`),
		}); auditErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to write admin audit log", "error", auditErr)
		}

		// Update global offer catalog to reflect suspended status.
		catalogParams := globaldb.UpsertMarketplaceOfferCatalogParams{
			ProviderOrgGlobalID: org.OrgID,
			ProviderOrgDomain:   req.OrgDomain,
			ProviderRegion:      string(org.Region),
			CapabilitySlug:      offer.CapabilitySlug,
			Headline:            offer.Headline,
			Summary:             offer.Summary,
			RegionsServed:       offer.RegionsServed,
			PricingHint:         offer.PricingHint,
			ContactMode:         offer.ContactMode,
			ContactValue:        offer.ContactValue,
			Status:              string(offer.Status),
		}
		if _, catalogErr := s.Global.UpsertMarketplaceOfferCatalog(ctx, catalogParams); catalogErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to upsert offer catalog after admin suspend", "error", catalogErr)
		}

		if err := json.NewEncoder(w).Encode(adminOfferToAPI(req.OrgDomain, offer)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// AdminReinstateOffer handles POST /admin/marketplace/provider-offers/reinstate
func AdminReinstateOffer(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.AdminReinstateOfferRequest
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

		org, err := s.Global.GetOrgByDomain(ctx, req.OrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get org by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var offer regionaldb.MarketplaceOffer
		err = s.WithRegionalTx(ctx, org.Region, func(qtx *regionaldb.Queries) error {
			var txErr error
			offer, txErr = qtx.AdminReinstateMarketplaceOffer(ctx,
				regionaldb.AdminReinstateMarketplaceOfferParams{
					OrgID:          org.OrgID,
					CapabilitySlug: req.CapabilitySlug,
				})
			return txErr
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to reinstate offer", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if auditErr := s.Global.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
			EventType:   "admin.marketplace_offer_reinstated",
			ActorUserID: adminUser.AdminUserID,
			IpAddress:   audit.ExtractClientIP(r),
			EventData:   []byte(`{"org_domain":"` + req.OrgDomain + `","capability_slug":"` + req.CapabilitySlug + `"}`),
		}); auditErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to write admin audit log", "error", auditErr)
		}

		// Update global offer catalog to reflect active status.
		catalogParams := globaldb.UpsertMarketplaceOfferCatalogParams{
			ProviderOrgGlobalID: org.OrgID,
			ProviderOrgDomain:   req.OrgDomain,
			ProviderRegion:      string(org.Region),
			CapabilitySlug:      offer.CapabilitySlug,
			Headline:            offer.Headline,
			Summary:             offer.Summary,
			RegionsServed:       offer.RegionsServed,
			PricingHint:         offer.PricingHint,
			ContactMode:         offer.ContactMode,
			ContactValue:        offer.ContactValue,
			Status:              string(offer.Status),
		}
		if _, catalogErr := s.Global.UpsertMarketplaceOfferCatalog(ctx, catalogParams); catalogErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to upsert offer catalog after admin reinstate", "error", catalogErr)
		}

		if err := json.NewEncoder(w).Encode(adminOfferToAPI(req.OrgDomain, offer)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}
