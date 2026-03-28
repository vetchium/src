package admin

import (
	"encoding/json"
	"net/http"
	"sort"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	admintypes "vetchium-api-server.typespec/admin"
	orgtypes "vetchium-api-server.typespec/org"
)

// ListMarketplaceProviderCapabilities handles POST /admin/list-marketplace-provider-capabilities
func ListMarketplaceProviderCapabilities(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.ListMarketplaceProviderCapabilitiesRequest
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

		limit := 20
		if req.Limit != nil && *req.Limit > 0 {
			limit = *req.Limit
			if limit > 50 {
				limit = 50
			}
		}

		// Build filter params (no cursor for fan-out — TODO: full cross-region cursor support)
		var filterStatus regionaldb.NullOrgCapabilityStatus
		if req.FilterStatus != nil {
			filterStatus = regionaldb.NullOrgCapabilityStatus{
				OrgCapabilityStatus: regionaldb.OrgCapabilityStatus(*req.FilterStatus),
				Valid:               true,
			}
		}

		var filterOrgID pgtype.UUID
		if req.FilterOrgID != nil && *req.FilterOrgID != "" {
			if err := filterOrgID.Scan(*req.FilterOrgID); err != nil {
				log.Debug("invalid filter_org_id", "error", err)
				http.Error(w, "invalid filter_org_id", http.StatusBadRequest)
				return
			}
		}

		// Fan out to all regions
		var allCaps []regionaldb.OrgCapability
		for _, region := range s.AllRegions() {
			rdb := s.GetRegionalDB(region)
			if rdb == nil {
				continue
			}
			caps, err := rdb.ListOrgCapabilities(ctx, regionaldb.ListOrgCapabilitiesParams{
				FilterStatus:    filterStatus,
				FilterOrgID:     filterOrgID,
				CursorUpdatedAt: pgtype.Timestamptz{},
				CursorOrgID:     pgtype.UUID{},
				LimitCount:      100,
			})
			if err != nil {
				log.Error("failed to list org capabilities from region", "region", region, "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			allCaps = append(allCaps, caps...)
		}

		// Sort merged results by (updated_at DESC, org_id DESC)
		sort.Slice(allCaps, func(i, j int) bool {
			ti := allCaps[i].UpdatedAt.Time
			tj := allCaps[j].UpdatedAt.Time
			if !ti.Equal(tj) {
				return ti.After(tj)
			}
			// Compare org IDs as byte arrays (descending)
			for k := 15; k >= 0; k-- {
				if allCaps[i].OrgID.Bytes[k] != allCaps[j].OrgID.Bytes[k] {
					return allCaps[i].OrgID.Bytes[k] > allCaps[j].OrgID.Bytes[k]
				}
			}
			return false
		})

		// Apply limit + detect next cursor
		var nextCursor *string
		if len(allCaps) > limit {
			last := allCaps[limit-1]
			cursor := encodeCapabilityCursor(last.UpdatedAt.Time, last.OrgID)
			nextCursor = &cursor
			allCaps = allCaps[:limit]
		}

		capabilities := make([]orgtypes.OrgCapability, 0, len(allCaps))
		for _, cap := range allCaps {
			capabilities = append(capabilities, dbOrgCapabilityToAPI(cap))
		}

		resp := admintypes.ListMarketplaceProviderCapabilitiesResponse{
			Capabilities: capabilities,
			NextCursor:   nextCursor,
		}
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}
