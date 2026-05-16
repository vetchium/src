package org

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

func ListMySubscriptions(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.ListMySubscriptionsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.Logger(ctx).Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			s.Logger(ctx).Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		limit := int32(20)
		if req.Limit != nil && *req.Limit > 0 {
			limit = *req.Limit
		}

		var filterStatus regionaldb.NullMarketplaceSubscriptionStatus
		if req.FilterStatus != nil {
			filterStatus = regionaldb.NullMarketplaceSubscriptionStatus{
				MarketplaceSubscriptionStatus: regionaldb.MarketplaceSubscriptionStatus(*req.FilterStatus),
				Valid:                         true,
			}
		}

		var paginationKey pgtype.UUID
		if req.PaginationKey != nil {
			if err := paginationKey.Scan(*req.PaginationKey); err != nil {
				http.Error(w, "invalid pagination_key", http.StatusBadRequest)
				return
			}
		}

		rows, err := s.RegionalForCtx(ctx).ListMarketplaceSubscriptionsByConsumer(ctx, regionaldb.ListMarketplaceSubscriptionsByConsumerParams{
			ConsumerOrgID: orgUser.OrgID,
			FilterStatus:  filterStatus,
			PaginationKey: paginationKey,
			RowLimit:      limit + 1,
		})
		if err != nil {
			s.Logger(ctx).Error("failed to list subscriptions", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var nextKey *string
		if int32(len(rows)) > limit {
			rows = rows[:limit]
			k := uuidToString(rows[len(rows)-1].SubscriptionID)
			nextKey = &k
		}

		subs := make([]orgspec.MarketplaceSubscription, 0, len(rows))
		for _, row := range rows {
			subs = append(subs, buildSubscription(row))
		}

		json.NewEncoder(w).Encode(orgspec.ListMySubscriptionsResponse{
			Subscriptions:     subs,
			NextPaginationKey: nextKey,
		})
	}
}
