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

const defaultIncomingSubscriptionLimit = 20
const maxIncomingSubscriptionLimit = 100

// ListIncomingSubscriptions handles POST /org/marketplace/incoming-subscriptions/list
func ListIncomingSubscriptions(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.ListIncomingSubscriptionsRequest
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

		limit := int32(defaultIncomingSubscriptionLimit)
		if req.Limit != nil && *req.Limit > 0 {
			if int32(*req.Limit) < maxIncomingSubscriptionLimit {
				limit = int32(*req.Limit)
			} else {
				limit = maxIncomingSubscriptionLimit
			}
		}

		params := regionaldb.ListIncomingMarketplaceSubscriptionsParams{
			ProviderOrgGlobalID: orgUser.OrgID,
			LimitCount:          limit + 1,
		}
		if req.CapabilitySlug != nil {
			params.FilterCapabilitySlug = pgtype.Text{String: *req.CapabilitySlug, Valid: true}
		}
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			parts := parseSubscriptionPaginationKey(*req.PaginationKey)
			if parts != nil {
				params.PaginationKeyUpdatedAt = pgtype.Timestamptz{Time: parts.updatedAt, Valid: true}
				params.PaginationKeyConsumerDomain = parts.orgDomain
				params.PaginationKeyCapabilitySlug = parts.capabilitySlug
			}
		}

		rows, err := s.Regional.ListIncomingMarketplaceSubscriptions(ctx, params)
		if err != nil {
			log.Error("failed to list incoming subscriptions", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(rows) > int(limit)
		if hasMore {
			rows = rows[:limit]
		}

		subs := make([]orgtypes.MarketplaceIncomingSubscription, 0, len(rows))
		for _, row := range rows {
			subs = append(subs, dbSubscriptionToIncomingAPI(row))
		}

		var nextKey *string
		if hasMore && len(rows) > 0 {
			last := rows[len(rows)-1]
			key := encodeIncomingSubscriptionPaginationKey(last.UpdatedAt.Time, last.ConsumerOrgDomain, last.CapabilitySlug)
			nextKey = &key
		}

		resp := orgtypes.ListIncomingSubscriptionsResponse{
			Subscriptions:     subs,
			NextPaginationKey: nextKey,
		}
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// GetIncomingSubscription handles POST /org/marketplace/incoming-subscriptions/get
func GetIncomingSubscription(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.GetIncomingSubscriptionRequest
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

		// Look up consumer org by domain
		consumerOrg, err := s.Global.GetOrgByDomain(ctx, req.ConsumerOrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get consumer org", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		sub, err := s.Regional.GetIncomingMarketplaceSubscription(ctx,
			regionaldb.GetIncomingMarketplaceSubscriptionParams{
				ProviderOrgGlobalID: orgUser.OrgID,
				ConsumerOrgID:       consumerOrg.OrgID,
				CapabilitySlug:      req.CapabilitySlug,
			})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get incoming subscription", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if err := json.NewEncoder(w).Encode(dbSubscriptionToIncomingAPI(sub)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// ProviderApproveSubscription handles POST /org/marketplace/incoming-subscriptions/provider-approve
func ProviderApproveSubscription(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.ProviderApproveSubscriptionRequest
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

		// Look up consumer org
		consumerOrg, err := s.Global.GetOrgByDomain(ctx, req.ConsumerOrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get consumer org", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Load the subscription to determine next status
		existing, err := s.Regional.GetIncomingMarketplaceSubscription(ctx,
			regionaldb.GetIncomingMarketplaceSubscriptionParams{
				ProviderOrgGlobalID: orgUser.OrgID,
				ConsumerOrgID:       consumerOrg.OrgID,
				CapabilitySlug:      req.CapabilitySlug,
			})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get subscription for approve", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if existing.Status != regionaldb.MarketplaceSubscriptionStatusProviderReview {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Determine next status after provider approval
		nextStatus := determineNextSubscriptionStatus(existing)

		var sub regionaldb.MarketplaceSubscription
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			if nextStatus == regionaldb.MarketplaceSubscriptionStatusActive {
				sub, txErr = qtx.ActivateMarketplaceSubscription(ctx, regionaldb.ActivateMarketplaceSubscriptionParams{
					ConsumerOrgID:       consumerOrg.OrgID,
					ProviderOrgGlobalID: orgUser.OrgID,
					CapabilitySlug:      req.CapabilitySlug,
					ExpectedStatus:      existing.Status,
				})
			} else {
				sub, txErr = qtx.AdvanceMarketplaceSubscriptionStatus(ctx, regionaldb.AdvanceMarketplaceSubscriptionStatusParams{
					NewStatus:           nextStatus,
					ConsumerOrgID:       consumerOrg.OrgID,
					ProviderOrgGlobalID: orgUser.OrgID,
					CapabilitySlug:      req.CapabilitySlug,
					ExpectedStatus:      existing.Status,
				})
			}
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_subscription_provider_approved",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"consumer_org_domain":"` + req.ConsumerOrgDomain + `","capability_slug":"` + req.CapabilitySlug + `"}`),
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to approve subscription", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Update global routing
		updateSubscriptionRoutingFromSub(s, r, sub)

		if err := json.NewEncoder(w).Encode(dbSubscriptionToIncomingAPI(sub)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// ProviderRejectSubscription handles POST /org/marketplace/incoming-subscriptions/provider-reject
func ProviderRejectSubscription(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.ProviderRejectSubscriptionRequest
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

		// Look up consumer org
		consumerOrg, err := s.Global.GetOrgByDomain(ctx, req.ConsumerOrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get consumer org", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		reviewNote := pgtype.Text{}
		if req.ReviewNote != "" {
			reviewNote = pgtype.Text{String: req.ReviewNote, Valid: true}
		}

		var sub regionaldb.MarketplaceSubscription
		err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			var txErr error
			sub, txErr = qtx.ProviderRejectMarketplaceSubscription(ctx,
				regionaldb.ProviderRejectMarketplaceSubscriptionParams{
					ReviewNote:          reviewNote,
					ProviderOrgGlobalID: orgUser.OrgID,
					ConsumerOrgID:       consumerOrg.OrgID,
					CapabilitySlug:      req.CapabilitySlug,
				})
			if txErr != nil {
				return txErr
			}
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_subscription_provider_rejected",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   []byte(`{"consumer_org_domain":"` + req.ConsumerOrgDomain + `","capability_slug":"` + req.CapabilitySlug + `"}`),
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to reject subscription", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Update global routing
		updateSubscriptionRoutingFromSub(s, r, sub)

		if err := json.NewEncoder(w).Encode(dbSubscriptionToIncomingAPI(sub)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// determineNextSubscriptionStatus determines what status a subscription should move to
// after provider approval, based on remaining gates.
func determineNextSubscriptionStatus(sub regionaldb.MarketplaceSubscription) regionaldb.MarketplaceSubscriptionStatus {
	if sub.RequiresAdminReview {
		return regionaldb.MarketplaceSubscriptionStatusAdminReview
	}
	if sub.RequiresContract {
		return regionaldb.MarketplaceSubscriptionStatusAwaitingContract
	}
	if sub.RequiresPayment {
		return regionaldb.MarketplaceSubscriptionStatusAwaitingPayment
	}
	return regionaldb.MarketplaceSubscriptionStatusActive
}

// updateSubscriptionRoutingFromSub upserts the subscription routing entry after a status change.
// Logs CONSISTENCY_ALERT if the update fails.
func updateSubscriptionRoutingFromSub(s *server.RegionalServer, r *http.Request, sub regionaldb.MarketplaceSubscription) {
	ctx := r.Context()
	log := s.Logger(ctx)
	routingErr := s.Global.UpsertMarketplaceSubscriptionRouting(ctx, globaldb.UpsertMarketplaceSubscriptionRoutingParams{
		ConsumerOrgGlobalID: sub.ConsumerOrgID,
		ConsumerOrgDomain:   sub.ConsumerOrgDomain,
		ConsumerRegion:      string(s.CurrentRegion),
		ProviderOrgGlobalID: sub.ProviderOrgGlobalID,
		ProviderOrgDomain:   sub.ProviderOrgDomain,
		ProviderRegion:      sub.ProviderRegion,
		CapabilitySlug:      sub.CapabilitySlug,
		Status:              string(sub.Status),
	})
	if routingErr != nil {
		log.Error("CONSISTENCY_ALERT: failed to upsert subscription routing", "error", routingErr)
	}
}
