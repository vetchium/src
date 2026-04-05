package org

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

const defaultSubscriptionLimit = 20
const maxSubscriptionLimit = 100

// ListConsumerSubscriptions handles POST /org/marketplace/consumer-subscriptions/list
func ListConsumerSubscriptions(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.ListConsumerSubscriptionsRequest
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
			parts := parseSubscriptionPaginationKey(*req.PaginationKey)
			if parts != nil {
				params.PaginationKeyUpdatedAt = pgtype.Timestamptz{Time: parts.updatedAt, Valid: true}
				params.PaginationKeyProviderDomain = parts.orgDomain
				params.PaginationKeyCapabilitySlug = parts.capabilitySlug
			}
		}

		rows, err := s.Regional.ListConsumerMarketplaceSubscriptions(ctx, params)
		if err != nil {
			log.Error("failed to list consumer subscriptions", "error", err)
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
			last := rows[len(rows)-1]
			key := encodeSubscriptionPaginationKey(last.UpdatedAt.Time, last.ProviderOrgDomain, last.CapabilitySlug)
			nextKey = &key
		}

		resp := orgtypes.ListConsumerSubscriptionsResponse{
			Subscriptions:     subs,
			NextPaginationKey: nextKey,
		}
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

type subscriptionPaginationKey struct {
	updatedAt      time.Time
	orgDomain      string
	capabilitySlug string
}

func parseSubscriptionPaginationKey(key string) *subscriptionPaginationKey {
	// format: "RFC3339Nano|domain|capabilitySlug"
	parts := strings.SplitN(key, "|", 3)
	if len(parts) != 3 {
		return nil
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return nil
	}
	return &subscriptionPaginationKey{updatedAt: t, orgDomain: parts[1], capabilitySlug: parts[2]}
}

// GetConsumerSubscription handles POST /org/marketplace/consumer-subscriptions/get
func GetConsumerSubscription(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.GetConsumerSubscriptionRequest
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

		// Look up the provider org by domain to get their global ID
		providerOrg, err := s.Global.GetOrgByDomain(ctx, req.ProviderOrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get provider org", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		sub, err := s.Regional.GetMarketplaceSubscriptionByConsumerAndProvider(ctx,
			regionaldb.GetMarketplaceSubscriptionByConsumerAndProviderParams{
				ConsumerOrgID:       orgUser.OrgID,
				ProviderOrgGlobalID: providerOrg.OrgID,
				CapabilitySlug:      req.CapabilitySlug,
			})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get consumer subscription", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if err := json.NewEncoder(w).Encode(dbSubscriptionToAPI(sub)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// RequestConsumerSubscription handles POST /org/marketplace/consumer-subscriptions/request
func RequestConsumerSubscription(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.RequestConsumerSubscriptionRequest
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

		// Look up the catalog entry to find provider org and capability details
		catalogEntry, err := s.Global.GetMarketplaceOfferCatalogEntry(ctx, globaldb.GetMarketplaceOfferCatalogEntryParams{
			ProviderOrgDomain: req.ProviderOrgDomain,
			CapabilitySlug:    req.CapabilitySlug,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get catalog entry", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Look up the capability for subscription approval gates
		cap, err := s.Global.GetMarketplaceCapabilityBySlug(ctx, req.CapabilitySlug)
		if err != nil {
			log.Error("failed to get capability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if !cap.ConsumerEnabled {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Prevent self-subscription
		if catalogEntry.ProviderOrgGlobalID == orgUser.OrgID {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Get the consumer org's primary domain
		consumerDomains, err := s.Global.GetGlobalOrgDomainsByOrg(ctx, orgUser.OrgID)
		if err != nil || len(consumerDomains) == 0 {
			log.Error("failed to get consumer org domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Determine gate flags based on subscription_approval
		requiresProviderReview := cap.SubscriptionApproval == "provider" || cap.SubscriptionApproval == "provider_and_admin"
		requiresAdminReview := cap.SubscriptionApproval == "admin" || cap.SubscriptionApproval == "provider_and_admin"

		requestNote := pgtype.Text{}
		if req.RequestNote != nil {
			requestNote = pgtype.Text{String: *req.RequestNote, Valid: true}
		}

		upsertParams := regionaldb.UpsertMarketplaceSubscriptionRequestedParams{
			ConsumerOrgID:          orgUser.OrgID,
			ConsumerOrgDomain:      consumerDomains[0].Domain,
			ProviderOrgGlobalID:    catalogEntry.ProviderOrgGlobalID,
			ProviderOrgDomain:      req.ProviderOrgDomain,
			ProviderRegion:         catalogEntry.ProviderRegion,
			CapabilitySlug:         req.CapabilitySlug,
			RequestNote:            requestNote,
			RequiresProviderReview: requiresProviderReview,
			RequiresAdminReview:    requiresAdminReview,
			RequiresContract:       cap.ContractRequired,
			RequiresPayment:        cap.PaymentRequired,
		}

		var sub regionaldb.MarketplaceSubscription
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			sub, txErr = qtx.UpsertMarketplaceSubscriptionRequested(ctx, upsertParams)
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_subscription_requested",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"provider_org_domain":"` + req.ProviderOrgDomain + `","capability_slug":"` + req.CapabilitySlug + `"}`),
			})
		})
		if err != nil {
			log.Error("failed to request subscription", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Upsert the global routing entry as a compensating write
		routingErr := s.Global.UpsertMarketplaceSubscriptionRouting(ctx, globaldb.UpsertMarketplaceSubscriptionRoutingParams{
			ConsumerOrgGlobalID: orgUser.OrgID,
			ConsumerOrgDomain:   consumerDomains[0].Domain,
			ConsumerRegion:      string(s.CurrentRegion),
			ProviderOrgGlobalID: catalogEntry.ProviderOrgGlobalID,
			ProviderOrgDomain:   req.ProviderOrgDomain,
			ProviderRegion:      catalogEntry.ProviderRegion,
			CapabilitySlug:      req.CapabilitySlug,
			Status:              string(sub.Status),
		})
		if routingErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to upsert subscription routing", "error", routingErr)
		}

		if err := json.NewEncoder(w).Encode(dbSubscriptionToAPI(sub)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// CancelConsumerSubscription handles POST /org/marketplace/consumer-subscriptions/cancel
func CancelConsumerSubscription(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.CancelConsumerSubscriptionRequest
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

		// Look up provider org
		providerOrg, err := s.Global.GetOrgByDomain(ctx, req.ProviderOrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get provider org", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var sub regionaldb.MarketplaceSubscription
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			sub, txErr = qtx.CancelMarketplaceSubscription(ctx, regionaldb.CancelMarketplaceSubscriptionParams{
				ConsumerOrgID:       orgUser.OrgID,
				ProviderOrgGlobalID: providerOrg.OrgID,
				CapabilitySlug:      req.CapabilitySlug,
			})
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_subscription_cancelled",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"provider_org_domain":"` + req.ProviderOrgDomain + `","capability_slug":"` + req.CapabilitySlug + `"}`),
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to cancel subscription", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Update the global routing status
		consumerDomains, domErr := s.Global.GetGlobalOrgDomainsByOrg(ctx, orgUser.OrgID)
		if domErr == nil && len(consumerDomains) > 0 {
			providerDomains, provDomErr := s.Global.GetGlobalOrgDomainsByOrg(ctx, providerOrg.OrgID)
			if provDomErr == nil && len(providerDomains) > 0 {
				routingErr := s.Global.UpsertMarketplaceSubscriptionRouting(ctx, globaldb.UpsertMarketplaceSubscriptionRoutingParams{
					ConsumerOrgGlobalID: orgUser.OrgID,
					ConsumerOrgDomain:   consumerDomains[0].Domain,
					ConsumerRegion:      string(s.CurrentRegion),
					ProviderOrgGlobalID: providerOrg.OrgID,
					ProviderOrgDomain:   providerDomains[0].Domain,
					ProviderRegion:      sub.ProviderRegion,
					CapabilitySlug:      req.CapabilitySlug,
					Status:              string(sub.Status),
				})
				if routingErr != nil {
					log.Error("CONSISTENCY_ALERT: failed to upsert subscription routing after cancel", "error", routingErr)
				}
			}
		}

		if err := json.NewEncoder(w).Encode(dbSubscriptionToAPI(sub)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}
