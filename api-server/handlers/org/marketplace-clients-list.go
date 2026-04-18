package org

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

func ListMyClients(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.ListMyClientsRequest
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

		var paginationKey pgtype.UUID
		if req.PaginationKey != nil {
			if err := paginationKey.Scan(*req.PaginationKey); err != nil {
				http.Error(w, "invalid pagination_key", http.StatusBadRequest)
				return
			}
		}

		// Read subscription index from global DB (provider-centric view)
		rows, err := s.Global.ListSubscriptionsForProvider(ctx, globaldb.ListSubscriptionsForProviderParams{
			ProviderOrgID: orgUser.OrgID,
			PaginationKey: paginationKey,
			RowLimit:      limit + 1,
		})
		if err != nil {
			s.Logger(ctx).Error("failed to list clients", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		var nextKey *string
		if int32(len(rows)) > limit {
			rows = rows[:limit]
			k := uuidToString(rows[len(rows)-1].SubscriptionID)
			nextKey = &k
		}

		clients := make([]orgspec.MarketplaceClient, 0, len(rows))
		for _, row := range rows {
			// Look up consumer org domain from global DB
			consumerOrgDomain := ""
			consumerOrg, err := s.Global.GetOrgByID(ctx, row.ConsumerOrgID)
			if err == nil {
				consumerOrgDomain = consumerOrg.OrgName
			}

			clients = append(clients, orgspec.MarketplaceClient{
				SubscriptionID:    uuidToString(row.SubscriptionID),
				ConsumerOrgDomain: consumerOrgDomain,
				ListingNumber:     0, // cross-region lookup required for full detail
				RequestNote:       "",
				Status:            orgspec.MarketplaceSubscriptionStatus(row.Status),
				StartedAt:         row.UpdatedAt.Time.Format(time.RFC3339),
			})
		}

		json.NewEncoder(w).Encode(orgspec.ListMyClientsResponse{
			Clients:           clients,
			NextPaginationKey: nextKey,
		})
	}
}
