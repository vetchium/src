package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

const defaultMarketplaceCapabilityLimit = 20
const maxMarketplaceCapabilityLimit = 100

// ListMarketplaceCapabilities handles POST /org/marketplace/capabilities/list
func ListMarketplaceCapabilities(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.ListMarketplaceCapabilitiesRequest
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

		limit := int32(defaultMarketplaceCapabilityLimit)
		if req.Limit != nil && *req.Limit > 0 {
			if int32(*req.Limit) < maxMarketplaceCapabilityLimit {
				limit = int32(*req.Limit)
			} else {
				limit = maxMarketplaceCapabilityLimit
			}
		}

		params := globaldb.ListActiveConsumerCapabilitiesParams{
			LimitCount: limit + 1,
		}
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			params.PaginationKey = pgtype.Text{String: *req.PaginationKey, Valid: true}
		}

		rows, err := s.Global.ListActiveConsumerCapabilities(ctx, params)
		if err != nil {
			log.Error("failed to list marketplace capabilities", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(rows) > int(limit)
		if hasMore {
			rows = rows[:limit]
		}

		caps := make([]orgtypes.MarketplaceCapability, 0, len(rows))
		for _, row := range rows {
			caps = append(caps, dbCapabilityToAPI(row))
		}

		var nextKey *string
		if hasMore && len(rows) > 0 {
			last := rows[len(rows)-1]
			key := last.CapabilitySlug
			nextKey = &key
		}

		resp := orgtypes.ListMarketplaceCapabilitiesResponse{
			Capabilities:      caps,
			NextPaginationKey: nextKey,
		}
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}

// GetMarketplaceCapability handles POST /org/marketplace/capabilities/get
func GetMarketplaceCapability(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.GetMarketplaceCapabilityRequest
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

		cap, err := s.Global.GetMarketplaceCapabilityBySlug(ctx, req.CapabilitySlug)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get marketplace capability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if err := json.NewEncoder(w).Encode(dbCapabilityToAPI(cap)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}
