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

// AdminListSubscriptions handles POST /admin/marketplace/consumer-subscriptions/list
// Iterates over all regional DBs and merges results.
func AdminListSubscriptions(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.AdminListSubscriptionsRequest
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

		limit := int32(defaultAdminSubscriptionLimit)
		if req.Limit != nil && *req.Limit > 0 {
			if int32(*req.Limit) < maxAdminSubscriptionLimit {
				limit = int32(*req.Limit)
			} else {
				limit = maxAdminSubscriptionLimit
			}
		}

		// Resolve optional org domain filters to org UUIDs.
		var filterConsumerOrgID pgtype.UUID
		if req.FilterConsumerOrgDomain != nil && *req.FilterConsumerOrgDomain != "" {
			org, err := s.Global.GetOrgByDomain(ctx, *req.FilterConsumerOrgDomain)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					resp := admintypes.AdminListSubscriptionsResponse{
						Subscriptions: []admintypes.AdminMarketplaceSubscription{},
					}
					json.NewEncoder(w).Encode(resp)
					return
				}
				log.Error("failed to get consumer org by domain", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			filterConsumerOrgID = org.OrgID
		}

		var filterProviderOrgGlobalID pgtype.UUID
		if req.FilterProviderOrgDomain != nil && *req.FilterProviderOrgDomain != "" {
			org, err := s.Global.GetOrgByDomain(ctx, *req.FilterProviderOrgDomain)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					resp := admintypes.AdminListSubscriptionsResponse{
						Subscriptions: []admintypes.AdminMarketplaceSubscription{},
					}
					json.NewEncoder(w).Encode(resp)
					return
				}
				log.Error("failed to get provider org by domain", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			filterProviderOrgGlobalID = org.OrgID
		}

		var filterStatus regionaldb.NullMarketplaceSubscriptionStatus
		if req.FilterStatus != nil && *req.FilterStatus != "" {
			filterStatus = regionaldb.NullMarketplaceSubscriptionStatus{
				MarketplaceSubscriptionStatus: regionaldb.MarketplaceSubscriptionStatus(*req.FilterStatus),
				Valid:                         true,
			}
		}

		var filterCapSlug pgtype.Text
		if req.FilterCapabilitySlug != nil && *req.FilterCapabilitySlug != "" {
			filterCapSlug = pgtype.Text{String: *req.FilterCapabilitySlug, Valid: true}
		}

		var paginationKey pgtype.Text
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			paginationKey = pgtype.Text{String: *req.PaginationKey, Valid: true}
		}

		var all []regionaldb.MarketplaceSubscription

		for _, region := range s.AllRegions() {
			rdb := s.GetRegionalDB(region)
			if rdb == nil {
				continue
			}
			rows, err := rdb.ListAllMarketplaceSubscriptions(ctx, regionaldb.ListAllMarketplaceSubscriptionsParams{
				FilterConsumerOrgID:       filterConsumerOrgID,
				FilterProviderOrgGlobalID: filterProviderOrgGlobalID,
				FilterCapabilitySlug:      filterCapSlug,
				FilterStatus:              filterStatus,
				PaginationKey:             paginationKey,
				LimitCount:                limit + 1,
			})
			if err != nil {
				log.Error("failed to list subscriptions in region", "region", region, "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			all = append(all, rows...)
		}

		// Sort by consumer_org_domain, provider_org_domain, capability_slug.
		sort.Slice(all, func(i, j int) bool {
			if all[i].ConsumerOrgDomain != all[j].ConsumerOrgDomain {
				return all[i].ConsumerOrgDomain < all[j].ConsumerOrgDomain
			}
			if all[i].ProviderOrgDomain != all[j].ProviderOrgDomain {
				return all[i].ProviderOrgDomain < all[j].ProviderOrgDomain
			}
			return all[i].CapabilitySlug < all[j].CapabilitySlug
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
			last := all[len(all)-1]
			k := last.ConsumerOrgDomain
			nextKey = &k
		}

		resp := admintypes.AdminListSubscriptionsResponse{
			Subscriptions:     subs,
			NextPaginationKey: nextKey,
		}
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// resolveConsumerAndProvider looks up consumer and provider orgs, returning false if an error
// was already written to w.
func resolveConsumerAndProvider(
	s *server.GlobalServer,
	w http.ResponseWriter,
	r *http.Request,
	consumerDomain, providerDomain string,
) (consumerOrg, providerOrg globaldb.Org, ok bool) {
	ctx := r.Context()
	log := s.Logger(ctx)

	cOrg, err := s.Global.GetOrgByDomain(ctx, consumerDomain)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			w.WriteHeader(http.StatusNotFound)
			return globaldb.Org{}, globaldb.Org{}, false
		}
		log.Error("failed to get consumer org", "error", err)
		http.Error(w, "", http.StatusInternalServerError)
		return globaldb.Org{}, globaldb.Org{}, false
	}

	pOrg, err := s.Global.GetOrgByDomain(ctx, providerDomain)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			w.WriteHeader(http.StatusNotFound)
			return globaldb.Org{}, globaldb.Org{}, false
		}
		log.Error("failed to get provider org", "error", err)
		http.Error(w, "", http.StatusInternalServerError)
		return globaldb.Org{}, globaldb.Org{}, false
	}

	return cOrg, pOrg, true
}

// AdminGetSubscription handles POST /admin/marketplace/consumer-subscriptions/get
func AdminGetSubscription(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.AdminGetSubscriptionRequest
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

		consumerOrg, providerOrg, ok := resolveConsumerAndProvider(s, w, r, req.ConsumerOrgDomain, req.ProviderOrgDomain)
		if !ok {
			return
		}

		// The subscription lives in the consumer's region.
		rdb := s.GetRegionalDB(consumerOrg.Region)
		if rdb == nil {
			log.Error("no regional DB for consumer org region", "region", consumerOrg.Region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		sub, err := rdb.GetMarketplaceSubscriptionByConsumerAndProvider(ctx,
			regionaldb.GetMarketplaceSubscriptionByConsumerAndProviderParams{
				ConsumerOrgID:       consumerOrg.OrgID,
				ProviderOrgGlobalID: providerOrg.OrgID,
				CapabilitySlug:      req.CapabilitySlug,
			})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get subscription", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if err := json.NewEncoder(w).Encode(adminSubscriptionToAPI(sub)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// adminDetermineNextStatusAfterAdminApproval determines what status a subscription should
// move to after admin approval, based on remaining gates.
func adminDetermineNextStatusAfterAdminApproval(sub regionaldb.MarketplaceSubscription) regionaldb.MarketplaceSubscriptionStatus {
	if sub.RequiresContract {
		return regionaldb.MarketplaceSubscriptionStatusAwaitingContract
	}
	if sub.RequiresPayment {
		return regionaldb.MarketplaceSubscriptionStatusAwaitingPayment
	}
	return regionaldb.MarketplaceSubscriptionStatusActive
}

// AdminApproveSubscription handles POST /admin/marketplace/consumer-subscriptions/approve
func AdminApproveSubscription(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.AdminApproveSubscriptionRequest
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

		consumerOrg, providerOrg, ok := resolveConsumerAndProvider(s, w, r, req.ConsumerOrgDomain, req.ProviderOrgDomain)
		if !ok {
			return
		}

		// Load existing subscription to determine next status.
		rdb := s.GetRegionalDB(consumerOrg.Region)
		if rdb == nil {
			log.Error("no regional DB for consumer org region", "region", consumerOrg.Region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		existing, err := rdb.GetMarketplaceSubscriptionByConsumerAndProvider(ctx,
			regionaldb.GetMarketplaceSubscriptionByConsumerAndProviderParams{
				ConsumerOrgID:       consumerOrg.OrgID,
				ProviderOrgGlobalID: providerOrg.OrgID,
				CapabilitySlug:      req.CapabilitySlug,
			})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get subscription for admin approve", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if existing.Status != regionaldb.MarketplaceSubscriptionStatusAdminReview {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		nextStatus := adminDetermineNextStatusAfterAdminApproval(existing)

		var sub regionaldb.MarketplaceSubscription
		err = s.WithRegionalTx(ctx, consumerOrg.Region, func(qtx *regionaldb.Queries) error {
			var txErr error
			if nextStatus == regionaldb.MarketplaceSubscriptionStatusActive {
				sub, txErr = qtx.AdminActivateMarketplaceSubscription(ctx,
					regionaldb.AdminActivateMarketplaceSubscriptionParams{
						ConsumerOrgID:       consumerOrg.OrgID,
						ProviderOrgGlobalID: providerOrg.OrgID,
						CapabilitySlug:      req.CapabilitySlug,
					})
			} else {
				sub, txErr = qtx.AdvanceMarketplaceSubscriptionStatus(ctx,
					regionaldb.AdvanceMarketplaceSubscriptionStatusParams{
						NewStatus:           nextStatus,
						ConsumerOrgID:       consumerOrg.OrgID,
						ProviderOrgGlobalID: providerOrg.OrgID,
						CapabilitySlug:      req.CapabilitySlug,
						ExpectedStatus:      existing.Status,
					})
			}
			return txErr
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

		if auditErr := s.Global.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
			EventType:   "admin.marketplace_subscription_approved",
			ActorUserID: adminUser.AdminUserID,
			IpAddress:   audit.ExtractClientIP(r),
			EventData: []byte(`{"consumer_org_domain":"` + req.ConsumerOrgDomain +
				`","provider_org_domain":"` + req.ProviderOrgDomain +
				`","capability_slug":"` + req.CapabilitySlug + `"}`),
		}); auditErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to write admin audit log", "error", auditErr)
		}

		// Update global subscription routing.
		updateAdminSubscriptionRouting(s, r, sub, consumerOrg.Region)

		if err := json.NewEncoder(w).Encode(adminSubscriptionToAPI(sub)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// AdminRejectSubscription handles POST /admin/marketplace/consumer-subscriptions/reject
func AdminRejectSubscription(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.AdminRejectSubscriptionRequest
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

		consumerOrg, providerOrg, ok := resolveConsumerAndProvider(s, w, r, req.ConsumerOrgDomain, req.ProviderOrgDomain)
		if !ok {
			return
		}

		var sub regionaldb.MarketplaceSubscription
		err := s.WithRegionalTx(ctx, consumerOrg.Region, func(qtx *regionaldb.Queries) error {
			var txErr error
			sub, txErr = qtx.AdminRejectMarketplaceSubscription(ctx,
				regionaldb.AdminRejectMarketplaceSubscriptionParams{
					ConsumerOrgID:       consumerOrg.OrgID,
					ProviderOrgGlobalID: providerOrg.OrgID,
					CapabilitySlug:      req.CapabilitySlug,
					ReviewNote:          pgtype.Text{String: req.ReviewNote, Valid: true},
				})
			return txErr
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

		if auditErr := s.Global.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
			EventType:   "admin.marketplace_subscription_rejected",
			ActorUserID: adminUser.AdminUserID,
			IpAddress:   audit.ExtractClientIP(r),
			EventData: []byte(`{"consumer_org_domain":"` + req.ConsumerOrgDomain +
				`","provider_org_domain":"` + req.ProviderOrgDomain +
				`","capability_slug":"` + req.CapabilitySlug + `"}`),
		}); auditErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to write admin audit log", "error", auditErr)
		}

		updateAdminSubscriptionRouting(s, r, sub, consumerOrg.Region)

		if err := json.NewEncoder(w).Encode(adminSubscriptionToAPI(sub)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// AdminMarkContractSigned handles POST /admin/marketplace/consumer-subscriptions/mark-contract-signed
func AdminMarkContractSigned(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.AdminMarkContractSignedRequest
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

		consumerOrg, providerOrg, ok := resolveConsumerAndProvider(s, w, r, req.ConsumerOrgDomain, req.ProviderOrgDomain)
		if !ok {
			return
		}

		// Load subscription to determine next status after contract signed.
		rdb := s.GetRegionalDB(consumerOrg.Region)
		if rdb == nil {
			log.Error("no regional DB for consumer org region", "region", consumerOrg.Region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		existing, err := rdb.GetMarketplaceSubscriptionByConsumerAndProvider(ctx,
			regionaldb.GetMarketplaceSubscriptionByConsumerAndProviderParams{
				ConsumerOrgID:       consumerOrg.OrgID,
				ProviderOrgGlobalID: providerOrg.OrgID,
				CapabilitySlug:      req.CapabilitySlug,
			})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get subscription for mark-contract-signed", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if existing.Status != regionaldb.MarketplaceSubscriptionStatusAwaitingContract {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// After contract signed, move to awaiting_payment if needed, otherwise active.
		var nextStatus regionaldb.MarketplaceSubscriptionStatus
		if existing.RequiresPayment {
			nextStatus = regionaldb.MarketplaceSubscriptionStatusAwaitingPayment
		} else {
			nextStatus = regionaldb.MarketplaceSubscriptionStatusActive
		}

		var sub regionaldb.MarketplaceSubscription
		err = s.WithRegionalTx(ctx, consumerOrg.Region, func(qtx *regionaldb.Queries) error {
			var txErr error
			if nextStatus == regionaldb.MarketplaceSubscriptionStatusActive {
				sub, txErr = qtx.AdminActivateMarketplaceSubscription(ctx,
					regionaldb.AdminActivateMarketplaceSubscriptionParams{
						ConsumerOrgID:       consumerOrg.OrgID,
						ProviderOrgGlobalID: providerOrg.OrgID,
						CapabilitySlug:      req.CapabilitySlug,
					})
			} else {
				sub, txErr = qtx.AdvanceMarketplaceSubscriptionStatus(ctx,
					regionaldb.AdvanceMarketplaceSubscriptionStatusParams{
						NewStatus:           nextStatus,
						ConsumerOrgID:       consumerOrg.OrgID,
						ProviderOrgGlobalID: providerOrg.OrgID,
						CapabilitySlug:      req.CapabilitySlug,
						ExpectedStatus:      existing.Status,
					})
			}
			return txErr
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to mark contract signed", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Insert billing record for contract signed event.
		billingNote := optionalText(req.Note)
		if _, billingErr := s.Global.InsertMarketplaceBillingRecord(ctx, globaldb.InsertMarketplaceBillingRecordParams{
			ConsumerOrgGlobalID: consumerOrg.OrgID,
			ConsumerOrgDomain:   req.ConsumerOrgDomain,
			ProviderOrgGlobalID: providerOrg.OrgID,
			ProviderOrgDomain:   req.ProviderOrgDomain,
			CapabilitySlug:      req.CapabilitySlug,
			EventType:           "contract_signed",
			Note:                billingNote,
		}); billingErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to insert billing record for contract signed", "error", billingErr)
		}

		if auditErr := s.Global.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
			EventType:   "admin.marketplace_contract_signed",
			ActorUserID: adminUser.AdminUserID,
			IpAddress:   audit.ExtractClientIP(r),
			EventData: []byte(`{"consumer_org_domain":"` + req.ConsumerOrgDomain +
				`","provider_org_domain":"` + req.ProviderOrgDomain +
				`","capability_slug":"` + req.CapabilitySlug + `"}`),
		}); auditErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to write admin audit log", "error", auditErr)
		}

		updateAdminSubscriptionRouting(s, r, sub, consumerOrg.Region)

		if err := json.NewEncoder(w).Encode(adminSubscriptionToAPI(sub)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// AdminWaiveContract handles POST /admin/marketplace/consumer-subscriptions/waive-contract
func AdminWaiveContract(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.AdminWaiveContractRequest
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

		consumerOrg, providerOrg, ok := resolveConsumerAndProvider(s, w, r, req.ConsumerOrgDomain, req.ProviderOrgDomain)
		if !ok {
			return
		}

		rdb := s.GetRegionalDB(consumerOrg.Region)
		if rdb == nil {
			log.Error("no regional DB for consumer org region", "region", consumerOrg.Region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		existing, err := rdb.GetMarketplaceSubscriptionByConsumerAndProvider(ctx,
			regionaldb.GetMarketplaceSubscriptionByConsumerAndProviderParams{
				ConsumerOrgID:       consumerOrg.OrgID,
				ProviderOrgGlobalID: providerOrg.OrgID,
				CapabilitySlug:      req.CapabilitySlug,
			})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get subscription for waive-contract", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if existing.Status != regionaldb.MarketplaceSubscriptionStatusAwaitingContract {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		var nextStatus regionaldb.MarketplaceSubscriptionStatus
		if existing.RequiresPayment {
			nextStatus = regionaldb.MarketplaceSubscriptionStatusAwaitingPayment
		} else {
			nextStatus = regionaldb.MarketplaceSubscriptionStatusActive
		}

		var sub regionaldb.MarketplaceSubscription
		err = s.WithRegionalTx(ctx, consumerOrg.Region, func(qtx *regionaldb.Queries) error {
			var txErr error
			if nextStatus == regionaldb.MarketplaceSubscriptionStatusActive {
				sub, txErr = qtx.AdminActivateMarketplaceSubscription(ctx,
					regionaldb.AdminActivateMarketplaceSubscriptionParams{
						ConsumerOrgID:       consumerOrg.OrgID,
						ProviderOrgGlobalID: providerOrg.OrgID,
						CapabilitySlug:      req.CapabilitySlug,
					})
			} else {
				sub, txErr = qtx.AdvanceMarketplaceSubscriptionStatus(ctx,
					regionaldb.AdvanceMarketplaceSubscriptionStatusParams{
						NewStatus:           nextStatus,
						ConsumerOrgID:       consumerOrg.OrgID,
						ProviderOrgGlobalID: providerOrg.OrgID,
						CapabilitySlug:      req.CapabilitySlug,
						ExpectedStatus:      existing.Status,
					})
			}
			return txErr
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to waive contract", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if _, billingErr := s.Global.InsertMarketplaceBillingRecord(ctx, globaldb.InsertMarketplaceBillingRecordParams{
			ConsumerOrgGlobalID: consumerOrg.OrgID,
			ConsumerOrgDomain:   req.ConsumerOrgDomain,
			ProviderOrgGlobalID: providerOrg.OrgID,
			ProviderOrgDomain:   req.ProviderOrgDomain,
			CapabilitySlug:      req.CapabilitySlug,
			EventType:           "contract_waived",
			Note:                pgtype.Text{String: req.Note, Valid: true},
		}); billingErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to insert billing record for waive-contract", "error", billingErr)
		}

		if auditErr := s.Global.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
			EventType:   "admin.marketplace_contract_waived",
			ActorUserID: adminUser.AdminUserID,
			IpAddress:   audit.ExtractClientIP(r),
			EventData: []byte(`{"consumer_org_domain":"` + req.ConsumerOrgDomain +
				`","provider_org_domain":"` + req.ProviderOrgDomain +
				`","capability_slug":"` + req.CapabilitySlug + `"}`),
		}); auditErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to write admin audit log", "error", auditErr)
		}

		updateAdminSubscriptionRouting(s, r, sub, consumerOrg.Region)

		if err := json.NewEncoder(w).Encode(adminSubscriptionToAPI(sub)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// AdminRecordPayment handles POST /admin/marketplace/consumer-subscriptions/record-payment
func AdminRecordPayment(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.AdminRecordPaymentRequest
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

		consumerOrg, providerOrg, ok := resolveConsumerAndProvider(s, w, r, req.ConsumerOrgDomain, req.ProviderOrgDomain)
		if !ok {
			return
		}

		rdb := s.GetRegionalDB(consumerOrg.Region)
		if rdb == nil {
			log.Error("no regional DB for consumer org region", "region", consumerOrg.Region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		existing, err := rdb.GetMarketplaceSubscriptionByConsumerAndProvider(ctx,
			regionaldb.GetMarketplaceSubscriptionByConsumerAndProviderParams{
				ConsumerOrgID:       consumerOrg.OrgID,
				ProviderOrgGlobalID: providerOrg.OrgID,
				CapabilitySlug:      req.CapabilitySlug,
			})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get subscription for record-payment", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if existing.Status != regionaldb.MarketplaceSubscriptionStatusAwaitingPayment {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		var sub regionaldb.MarketplaceSubscription
		err = s.WithRegionalTx(ctx, consumerOrg.Region, func(qtx *regionaldb.Queries) error {
			var txErr error
			sub, txErr = qtx.AdminActivateMarketplaceSubscription(ctx,
				regionaldb.AdminActivateMarketplaceSubscriptionParams{
					ConsumerOrgID:       consumerOrg.OrgID,
					ProviderOrgGlobalID: providerOrg.OrgID,
					CapabilitySlug:      req.CapabilitySlug,
				})
			return txErr
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to record payment", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if _, billingErr := s.Global.InsertMarketplaceBillingRecord(ctx, globaldb.InsertMarketplaceBillingRecordParams{
			ConsumerOrgGlobalID: consumerOrg.OrgID,
			ConsumerOrgDomain:   req.ConsumerOrgDomain,
			ProviderOrgGlobalID: providerOrg.OrgID,
			ProviderOrgDomain:   req.ProviderOrgDomain,
			CapabilitySlug:      req.CapabilitySlug,
			EventType:           "payment_recorded",
			Note:                optionalText(req.Note),
		}); billingErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to insert billing record for record-payment", "error", billingErr)
		}

		if auditErr := s.Global.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
			EventType:   "admin.marketplace_payment_recorded",
			ActorUserID: adminUser.AdminUserID,
			IpAddress:   audit.ExtractClientIP(r),
			EventData: []byte(`{"consumer_org_domain":"` + req.ConsumerOrgDomain +
				`","provider_org_domain":"` + req.ProviderOrgDomain +
				`","capability_slug":"` + req.CapabilitySlug + `"}`),
		}); auditErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to write admin audit log", "error", auditErr)
		}

		updateAdminSubscriptionRouting(s, r, sub, consumerOrg.Region)

		if err := json.NewEncoder(w).Encode(adminSubscriptionToAPI(sub)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// AdminWaivePayment handles POST /admin/marketplace/consumer-subscriptions/waive-payment
func AdminWaivePayment(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.AdminWaivePaymentRequest
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

		consumerOrg, providerOrg, ok := resolveConsumerAndProvider(s, w, r, req.ConsumerOrgDomain, req.ProviderOrgDomain)
		if !ok {
			return
		}

		rdb := s.GetRegionalDB(consumerOrg.Region)
		if rdb == nil {
			log.Error("no regional DB for consumer org region", "region", consumerOrg.Region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		existing, err := rdb.GetMarketplaceSubscriptionByConsumerAndProvider(ctx,
			regionaldb.GetMarketplaceSubscriptionByConsumerAndProviderParams{
				ConsumerOrgID:       consumerOrg.OrgID,
				ProviderOrgGlobalID: providerOrg.OrgID,
				CapabilitySlug:      req.CapabilitySlug,
			})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get subscription for waive-payment", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if existing.Status != regionaldb.MarketplaceSubscriptionStatusAwaitingPayment {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		var sub regionaldb.MarketplaceSubscription
		err = s.WithRegionalTx(ctx, consumerOrg.Region, func(qtx *regionaldb.Queries) error {
			var txErr error
			sub, txErr = qtx.AdminActivateMarketplaceSubscription(ctx,
				regionaldb.AdminActivateMarketplaceSubscriptionParams{
					ConsumerOrgID:       consumerOrg.OrgID,
					ProviderOrgGlobalID: providerOrg.OrgID,
					CapabilitySlug:      req.CapabilitySlug,
				})
			return txErr
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to waive payment", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if _, billingErr := s.Global.InsertMarketplaceBillingRecord(ctx, globaldb.InsertMarketplaceBillingRecordParams{
			ConsumerOrgGlobalID: consumerOrg.OrgID,
			ConsumerOrgDomain:   req.ConsumerOrgDomain,
			ProviderOrgGlobalID: providerOrg.OrgID,
			ProviderOrgDomain:   req.ProviderOrgDomain,
			CapabilitySlug:      req.CapabilitySlug,
			EventType:           "payment_waived",
			Note:                pgtype.Text{String: req.Note, Valid: true},
		}); billingErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to insert billing record for waive-payment", "error", billingErr)
		}

		if auditErr := s.Global.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
			EventType:   "admin.marketplace_payment_waived",
			ActorUserID: adminUser.AdminUserID,
			IpAddress:   audit.ExtractClientIP(r),
			EventData: []byte(`{"consumer_org_domain":"` + req.ConsumerOrgDomain +
				`","provider_org_domain":"` + req.ProviderOrgDomain +
				`","capability_slug":"` + req.CapabilitySlug + `"}`),
		}); auditErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to write admin audit log", "error", auditErr)
		}

		updateAdminSubscriptionRouting(s, r, sub, consumerOrg.Region)

		if err := json.NewEncoder(w).Encode(adminSubscriptionToAPI(sub)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// AdminCancelSubscription handles POST /admin/marketplace/consumer-subscriptions/cancel
func AdminCancelSubscription(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.AdminCancelSubscriptionRequest
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

		consumerOrg, providerOrg, ok := resolveConsumerAndProvider(s, w, r, req.ConsumerOrgDomain, req.ProviderOrgDomain)
		if !ok {
			return
		}

		var sub regionaldb.MarketplaceSubscription
		err := s.WithRegionalTx(ctx, consumerOrg.Region, func(qtx *regionaldb.Queries) error {
			var txErr error
			sub, txErr = qtx.AdminCancelMarketplaceSubscription(ctx,
				regionaldb.AdminCancelMarketplaceSubscriptionParams{
					ConsumerOrgID:       consumerOrg.OrgID,
					ProviderOrgGlobalID: providerOrg.OrgID,
					CapabilitySlug:      req.CapabilitySlug,
				})
			return txErr
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

		if auditErr := s.Global.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
			EventType:   "admin.marketplace_subscription_cancelled",
			ActorUserID: adminUser.AdminUserID,
			IpAddress:   audit.ExtractClientIP(r),
			EventData: []byte(`{"consumer_org_domain":"` + req.ConsumerOrgDomain +
				`","provider_org_domain":"` + req.ProviderOrgDomain +
				`","capability_slug":"` + req.CapabilitySlug + `"}`),
		}); auditErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to write admin audit log", "error", auditErr)
		}

		updateAdminSubscriptionRouting(s, r, sub, consumerOrg.Region)

		if err := json.NewEncoder(w).Encode(adminSubscriptionToAPI(sub)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// updateAdminSubscriptionRouting upserts the global subscription routing after an admin status change.
// consumerRegion is the region where the consumer org is registered.
func updateAdminSubscriptionRouting(s *server.GlobalServer, r *http.Request, sub regionaldb.MarketplaceSubscription, consumerRegion globaldb.Region) {
	ctx := r.Context()
	log := s.Logger(ctx)
	if routingErr := s.Global.UpsertMarketplaceSubscriptionRouting(ctx, globaldb.UpsertMarketplaceSubscriptionRoutingParams{
		ConsumerOrgGlobalID: sub.ConsumerOrgID,
		ConsumerOrgDomain:   sub.ConsumerOrgDomain,
		ConsumerRegion:      string(consumerRegion),
		ProviderOrgGlobalID: sub.ProviderOrgGlobalID,
		ProviderOrgDomain:   sub.ProviderOrgDomain,
		ProviderRegion:      sub.ProviderRegion,
		CapabilitySlug:      sub.CapabilitySlug,
		Status:              string(sub.Status),
	}); routingErr != nil {
		log.Error("CONSISTENCY_ALERT: failed to upsert subscription routing", "error", routingErr)
	}
}
