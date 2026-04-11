package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

const defaultSubscriptionLimit = 20
const maxSubscriptionLimit = 100

// RequestSubscription handles POST /org/marketplace/subscriptions/subscribe
// Creates or re-activates a subscription to a listing (direct-to-active, no approval step).
func RequestSubscription(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.RequestSubscriptionRequest
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

		// Look up the listing from the global catalog to find provider info and region.
		catalogEntry, err := s.Global.GetListingCatalogEntry(ctx, listingUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get catalog entry", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get consumer's primary domain.
		consumerDomains, err := s.Global.GetGlobalOrgDomainsByOrg(ctx, orgUser.OrgID)
		if err != nil {
			log.Error("failed to get consumer org domains", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		consumerDomain := getOrgPrimaryDomain(consumerDomains)
		if consumerDomain == "" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		region := middleware.OrgRegionFromContext(ctx)

		var sub regionaldb.MarketplaceSubscription
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			sub, txErr = qtx.UpsertMarketplaceSubscriptionActive(ctx, regionaldb.UpsertMarketplaceSubscriptionActiveParams{
				ListingID:           listingUUID,
				ConsumerOrgID:       orgUser.OrgID,
				ConsumerOrgDomain:   consumerDomain,
				ProviderOrgGlobalID: catalogEntry.OrgGlobalID,
				ProviderOrgDomain:   catalogEntry.OrgDomain,
				ProviderRegion:      catalogEntry.OrgRegion,
				CapabilityID:        catalogEntry.CapabilityID,
				RequestNote:         optionalListingText(req.RequestNote),
			})
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_subscription_created",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"listing_id":"` + req.ListingID + `","capability_id":"` + catalogEntry.CapabilityID + `"}`),
			})
		})
		if err != nil {
			log.Error("failed to create subscription", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Update global subscription index.
		if upsertErr := s.Global.UpsertSubscriptionIndex(ctx, globaldb.UpsertSubscriptionIndexParams{
			SubscriptionID:      sub.SubscriptionID,
			ListingID:           listingUUID,
			ConsumerOrgGlobalID: orgUser.OrgID,
			ConsumerOrgDomain:   consumerDomain,
			ConsumerRegion:      region,
			ProviderOrgGlobalID: catalogEntry.OrgGlobalID,
			ProviderOrgDomain:   catalogEntry.OrgDomain,
			CapabilityID:        catalogEntry.CapabilityID,
			Status:              string(sub.Status),
			StartedAt:           sub.StartedAt,
		}); upsertErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to update subscription index after subscribe", "listing_id", req.ListingID, "error", upsertErr)
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(dbSubscriptionToAPI(sub))
	}
}

// CancelSubscription handles POST /org/marketplace/subscriptions/cancel
func CancelSubscription(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.CancelSubscriptionRequest
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

		subUUID := parseListingUUID(req.SubscriptionID)
		if !subUUID.Valid {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		var sub regionaldb.MarketplaceSubscription
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			sub, txErr = qtx.CancelMarketplaceSubscription(ctx, regionaldb.CancelMarketplaceSubscriptionParams{
				SubscriptionID: subUUID,
				ConsumerOrgID:  orgUser.OrgID,
			})
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_subscription_cancelled",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"subscription_id":"` + req.SubscriptionID + `"}`),
			})
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

		json.NewEncoder(w).Encode(dbSubscriptionToAPI(sub))
	}
}

// ListSubscriptions handles POST /org/marketplace/subscriptions/list
// Returns subscriptions where the caller is the consumer.
func ListSubscriptions(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.ListSubscriptionsRequest
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

		limit := int32(defaultSubscriptionLimit)
		if req.Limit != nil && *req.Limit > 0 {
			if int32(*req.Limit) < maxSubscriptionLimit {
				limit = int32(*req.Limit)
			} else {
				limit = maxSubscriptionLimit
			}
		}

		params := regionaldb.ListConsumerMarketplaceSubscriptionsParams{
			ConsumerOrgID: orgUser.OrgID,
			LimitCount:    limit + 1,
		}
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			params.PaginationKey = parseListingUUID(*req.PaginationKey)
		}
		if req.FilterStatus != nil {
			params.FilterStatus = regionaldb.NullMarketplaceSubscriptionStatus{
				MarketplaceSubscriptionStatus: regionaldb.MarketplaceSubscriptionStatus(*req.FilterStatus),
				Valid:                         true,
			}
		}

		rows, err := s.Regional.ListConsumerMarketplaceSubscriptions(ctx, params)
		if err != nil {
			log.Error("failed to list subscriptions", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(rows) > int(limit)
		if hasMore {
			rows = rows[:limit]
		}

		subs := make([]orgtypes.MarketplaceSubscription, 0, len(rows))
		for _, row := range rows {
			subs = append(subs, dbSubscriptionToAPI(row))
		}

		var nextKey *string
		if hasMore && len(rows) > 0 {
			last := uuidToString(rows[len(rows)-1].SubscriptionID)
			nextKey = &last
		}

		json.NewEncoder(w).Encode(orgtypes.ListSubscriptionsResponse{
			Subscriptions:     subs,
			NextPaginationKey: nextKey,
		})
	}
}

// GetSubscription handles POST /org/marketplace/subscriptions/get
// Returns a subscription owned by the caller as consumer.
func GetSubscription(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.GetSubscriptionRequest
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

		subUUID := parseListingUUID(req.SubscriptionID)
		if !subUUID.Valid {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		sub, err := s.Regional.GetMarketplaceSubscriptionByID(ctx, subUUID)
		if err == nil && sub.ConsumerOrgID != orgUser.OrgID {
			err = pgx.ErrNoRows
		}
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get subscription", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(dbSubscriptionToAPI(sub))
	}
}
