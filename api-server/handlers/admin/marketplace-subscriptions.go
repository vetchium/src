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

const defaultAdminSubscriptionLimit = 50
const maxAdminSubscriptionLimit = 200

// AdminListSubscriptions handles POST /admin/marketplace/subscriptions/list
// Queries all regional DBs and merges results sorted by subscription_id.
func AdminListSubscriptions(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminListSubscriptionsRequest
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

		limit := int32(defaultAdminSubscriptionLimit)
		if req.Limit != nil && *req.Limit > 0 {
			if int32(*req.Limit) < maxAdminSubscriptionLimit {
				limit = int32(*req.Limit)
			} else {
				limit = maxAdminSubscriptionLimit
			}
		}

		// Resolve optional org domain filter to org UUID (filters consumer org).
		var filterConsumerOrgID pgtype.UUID
		if req.OrgDomain != nil && *req.OrgDomain != "" {
			orgEntry, err := s.Global.GetOrgByDomain(ctx, *req.OrgDomain)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					json.NewEncoder(w).Encode(admintypes.AdminListSubscriptionsResponse{
						Subscriptions: []admintypes.AdminMarketplaceSubscription{},
					})
					return
				}
				log.Error("failed to get org by domain", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			filterConsumerOrgID = orgEntry.OrgID
		}

		var filterCapID pgtype.Text
		if req.CapabilityID != nil && *req.CapabilityID != "" {
			filterCapID = pgtype.Text{String: *req.CapabilityID, Valid: true}
		}

		var filterStatus regionaldb.NullMarketplaceSubscriptionStatus
		if req.FilterStatus != nil {
			filterStatus = regionaldb.NullMarketplaceSubscriptionStatus{
				MarketplaceSubscriptionStatus: regionaldb.MarketplaceSubscriptionStatus(*req.FilterStatus),
				Valid:                         true,
			}
		}

		var paginationKey pgtype.UUID
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			paginationKey = parseUUID(*req.PaginationKey)
		}

		var all []regionaldb.MarketplaceSubscription
		for _, region := range s.AllRegions() {
			rdb := s.GetRegionalDB(region)
			if rdb == nil {
				continue
			}
			rows, err := rdb.ListAllMarketplaceSubscriptions(ctx, regionaldb.ListAllMarketplaceSubscriptionsParams{
				FilterCapabilityID:  filterCapID,
				FilterConsumerOrgID: filterConsumerOrgID,
				FilterStatus:        filterStatus,
				PaginationKey:       paginationKey,
				LimitCount:          limit + 1,
			})
			if err != nil {
				log.Error("failed to list subscriptions in region", "region", region, "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			all = append(all, rows...)
		}

		// Sort by subscription_id UUID string for stable global ordering.
		sort.Slice(all, func(i, j int) bool {
			return uuidToString(all[i].SubscriptionID) < uuidToString(all[j].SubscriptionID)
		})

		hasMore := len(all) > int(limit)
		if hasMore {
			all = all[:limit]
		}

		subs := make([]admintypes.AdminMarketplaceSubscription, 0, len(all))
		for _, sub := range all {
			subs = append(subs, adminSubscriptionToAPI(sub))
		}

		var nextKey *string
		if hasMore && len(all) > 0 {
			last := uuidToString(all[len(all)-1].SubscriptionID)
			nextKey = &last
		}

		json.NewEncoder(w).Encode(admintypes.AdminListSubscriptionsResponse{
			Subscriptions:     subs,
			NextPaginationKey: nextKey,
		})
	}
}

// AdminGetSubscription handles POST /admin/marketplace/subscriptions/get
// Uses the global subscription index to find the region, then fetches from that region.
func AdminGetSubscription(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminGetSubscriptionRequest
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

		subUUID := parseUUID(req.SubscriptionID)
		if !subUUID.Valid {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Look up the subscription's region from the global index.
		indexEntry, err := s.Global.GetSubscriptionIndexEntry(ctx, subUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get subscription index entry", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		rdb := s.GetRegionalDB(globaldb.Region(indexEntry.ConsumerRegion))
		if rdb == nil {
			log.Error("unknown region for subscription", "region", indexEntry.ConsumerRegion)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		sub, err := rdb.GetMarketplaceSubscriptionByID(ctx, subUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get subscription", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(adminSubscriptionToAPI(sub))
	}
}

// AdminCancelSubscription handles POST /admin/marketplace/subscriptions/cancel
func AdminCancelSubscription(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req admintypes.AdminCancelSubscriptionRequest
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

		subUUID := parseUUID(req.SubscriptionID)
		if !subUUID.Valid {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Look up region from global index.
		indexEntry, err := s.Global.GetSubscriptionIndexEntry(ctx, subUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get subscription index entry", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		region := globaldb.Region(indexEntry.ConsumerRegion)
		var sub regionaldb.MarketplaceSubscription
		err = s.WithRegionalTx(ctx, region, func(qtx *regionaldb.Queries) error {
			var txErr error
			sub, txErr = qtx.AdminCancelMarketplaceSubscription(ctx, subUUID)
			return txErr
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to cancel subscription", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Write admin audit log.
		if auditErr := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.marketplace_subscription_cancelled",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"subscription_id":"` + req.SubscriptionID + `"}`),
			})
		}); auditErr != nil {
			log.Error("failed to write audit log", "error", auditErr)
		}

		json.NewEncoder(w).Encode(adminSubscriptionToAPI(sub))
	}
}
