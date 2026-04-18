package admin

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

func AdminListMarketplaceSubscriptions(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.AdminListSubscriptionsRequest
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

		// Filter by provider org if requested
		var providerOrgID pgtype.UUID
		if req.FilterProviderOrgDomain != nil && *req.FilterProviderOrgDomain != "" {
			dom, err := s.Global.GetGlobalOrgDomain(ctx, *req.FilterProviderOrgDomain)
			if err == nil {
				providerOrgID = dom.OrgID
			}
		}

		var paginationKey pgtype.UUID
		if req.PaginationKey != nil {
			if err := paginationKey.Scan(*req.PaginationKey); err != nil {
				http.Error(w, "invalid pagination_key", http.StatusBadRequest)
				return
			}
		}

		rows, err := s.Global.ListSubscriptionsForProvider(ctx, globaldb.ListSubscriptionsForProviderParams{
			ProviderOrgID: providerOrgID,
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
			providerDomain := ""
			providerOrg, err := s.Global.GetOrgByID(ctx, row.ProviderOrgID)
			if err == nil {
				providerDomain = providerOrg.OrgName
			}
			consumerDomain := ""
			consumerOrg, err := s.Global.GetOrgByID(ctx, row.ConsumerOrgID)
			if err == nil {
				consumerDomain = consumerOrg.OrgName
			}

			subs = append(subs, orgspec.MarketplaceSubscription{
				SubscriptionID:        uuidToString(row.SubscriptionID),
				ListingID:             uuidToString(row.ListingID),
				ProviderOrgDomain:     providerDomain,
				ProviderListingNumber: 0,
				ConsumerOrgDomain:     consumerDomain,
				RequestNote:           "",
				Status:                orgspec.MarketplaceSubscriptionStatus(row.Status),
				StartedAt:             row.UpdatedAt.Time.Format(time.RFC3339),
				CreatedAt:             row.UpdatedAt.Time.Format(time.RFC3339),
				UpdatedAt:             row.UpdatedAt.Time.Format(time.RFC3339),
			})
		}

		json.NewEncoder(w).Encode(orgspec.AdminListSubscriptionsResponse{
			Subscriptions:     subs,
			NextPaginationKey: nextKey,
		})
	}
}
