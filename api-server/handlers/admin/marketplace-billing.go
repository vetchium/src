package admin

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	admintypes "vetchium-api-server.typespec/admin"
)

const defaultAdminBillingLimit = 50
const maxAdminBillingLimit = 200

// AdminListBilling handles POST /admin/marketplace/billing/list
func AdminListBilling(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.AdminListBillingRequest
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

		limit := int32(defaultAdminBillingLimit)
		if req.Limit != nil && *req.Limit > 0 {
			if int32(*req.Limit) < maxAdminBillingLimit {
				limit = int32(*req.Limit)
			} else {
				limit = maxAdminBillingLimit
			}
		}

		params := globaldb.ListMarketplaceBillingRecordsParams{
			LimitCount: limit + 1,
		}
		if req.FilterConsumerOrgDomain != nil && *req.FilterConsumerOrgDomain != "" {
			params.FilterConsumerOrgDomain = pgtype.Text{String: *req.FilterConsumerOrgDomain, Valid: true}
		}
		if req.FilterProviderOrgDomain != nil && *req.FilterProviderOrgDomain != "" {
			params.FilterProviderOrgDomain = pgtype.Text{String: *req.FilterProviderOrgDomain, Valid: true}
		}
		if req.FilterCapabilitySlug != nil && *req.FilterCapabilitySlug != "" {
			params.FilterCapabilitySlug = pgtype.Text{String: *req.FilterCapabilitySlug, Valid: true}
		}

		rows, err := s.Global.ListMarketplaceBillingRecords(ctx, params)
		if err != nil {
			log.Error("failed to list billing records", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(rows) > int(limit)
		if hasMore {
			rows = rows[:limit]
		}

		records := make([]admintypes.AdminBillingRecord, 0, len(rows))
		for _, row := range rows {
			records = append(records, adminBillingRecordToAPI(row))
		}

		var nextKey *string
		if hasMore && len(rows) > 0 {
			last := rows[len(rows)-1]
			k := last.CreatedAt.Time.String()
			nextKey = &k
		}

		resp := admintypes.AdminListBillingResponse{
			Records:           records,
			NextPaginationKey: nextKey,
		}
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}
