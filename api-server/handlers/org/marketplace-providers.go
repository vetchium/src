package org

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

const defaultProviderListLimit = 20
const maxProviderListLimit = 100

// ListMarketplaceProviders handles POST /org/marketplace/providers/list
func ListMarketplaceProviders(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.ListMarketplaceProvidersRequest
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

		limit := int32(defaultProviderListLimit)
		if req.Limit != nil && *req.Limit > 0 {
			if int32(*req.Limit) < maxProviderListLimit {
				limit = int32(*req.Limit)
			} else {
				limit = maxProviderListLimit
			}
		}

		params := globaldb.ListMarketplaceOfferCatalogParams{
			CapabilitySlug: req.CapabilitySlug,
			LimitCount:     limit + 1,
		}
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			params.PaginationKeyDomain = pgtype.Text{String: *req.PaginationKey, Valid: true}
		}

		rows, err := s.Global.ListMarketplaceOfferCatalog(ctx, params)
		if err != nil {
			log.Error("failed to list marketplace providers", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(rows) > int(limit)
		if hasMore {
			rows = rows[:limit]
		}

		providers := make([]orgtypes.MarketplaceProviderSummary, 0, len(rows))
		for _, row := range rows {
			providers = append(providers, dbCatalogEntryToProviderSummary(row))
		}

		var nextKey *string
		if hasMore && len(rows) > 0 {
			last := rows[len(rows)-1]
			nextKey = &last.ProviderOrgDomain
		}

		resp := orgtypes.ListMarketplaceProvidersResponse{
			Providers:         providers,
			NextPaginationKey: nextKey,
		}
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// GetMarketplaceProviderOffer handles POST /org/marketplace/providers/get-offer
func GetMarketplaceProviderOffer(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.GetMarketplaceProviderOfferRequest
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

		entry, err := s.Global.GetMarketplaceOfferCatalogEntry(ctx, globaldb.GetMarketplaceOfferCatalogEntryParams{
			ProviderOrgDomain: req.ProviderOrgDomain,
			CapabilitySlug:    req.CapabilitySlug,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get provider offer from catalog", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Return a MarketplaceOffer-like summary from the catalog
		result := orgtypes.MarketplaceOffer{
			CapabilitySlug: entry.CapabilitySlug,
			Headline:       entry.Headline,
			Summary:        entry.Summary,
			Description:    "", // Full description not in global catalog
			RegionsServed:  entry.RegionsServed,
			ContactMode:    orgtypes.MarketplaceContactMode(entry.ContactMode),
			ContactValue:   entry.ContactValue,
			Status:         orgtypes.MarketplaceOfferStatus(entry.Status),
			CreatedAt:      entry.CreatedAt.Time.UTC().Format(time.RFC3339),
			UpdatedAt:      entry.UpdatedAt.Time.UTC().Format(time.RFC3339),
		}
		if entry.PricingHint.Valid {
			result.PricingHint = &entry.PricingHint.String
		}

		if err := json.NewEncoder(w).Encode(result); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}
