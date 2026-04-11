package org

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

const defaultOrgCapabilityLimit = 50
const maxOrgCapabilityLimit = 200

// ListMarketplaceCapabilities handles POST /org/marketplace/capabilities/list
// Returns active capabilities with translations for the user's preferred locale (en-US fallback).
func ListMarketplaceCapabilities(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
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
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		limit := int32(defaultOrgCapabilityLimit)
		if req.Limit != nil && *req.Limit > 0 {
			if int32(*req.Limit) < maxOrgCapabilityLimit {
				limit = int32(*req.Limit)
			} else {
				limit = maxOrgCapabilityLimit
			}
		}

		params := globaldb.ListActiveMarketplaceCapabilitiesParams{
			LimitCount: limit + 1,
		}
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			params.PaginationKey = pgtype.Text{String: *req.PaginationKey, Valid: true}
		}

		rows, err := s.Global.ListActiveMarketplaceCapabilities(ctx, params)
		if err != nil {
			log.Error("failed to list capabilities", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(rows) > int(limit)
		if hasMore {
			rows = rows[:limit]
		}

		locale := orgUser.PreferredLanguage
		if locale == "" {
			locale = "en-US"
		}

		caps := make([]orgtypes.MarketplaceCapability, 0, len(rows))
		for _, row := range rows {
			caps = append(caps, resolveCapabilityLocale(s, ctx, log, row, locale))
		}

		var nextKey *string
		if hasMore && len(rows) > 0 {
			last := rows[len(rows)-1]
			nextKey = &last.CapabilityID
		}

		json.NewEncoder(w).Encode(orgtypes.ListMarketplaceCapabilitiesResponse{
			Capabilities:      caps,
			NextPaginationKey: nextKey,
		})
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
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		row, err := s.Global.GetMarketplaceCapabilityByID(ctx, req.CapabilityID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get capability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		locale := orgUser.PreferredLanguage
		if locale == "" {
			locale = "en-US"
		}

		json.NewEncoder(w).Encode(resolveCapabilityLocale(s, ctx, log, row, locale))
	}
}

// resolveCapabilityLocale returns a MarketplaceCapability with translated display_name/description
// for the given locale, falling back to en-US.
func resolveCapabilityLocale(s *server.RegionalServer, ctx context.Context, log *slog.Logger, row globaldb.MarketplaceCapability, locale string) orgtypes.MarketplaceCapability {
	displayName := ""
	description := ""

	for _, tryLocale := range []string{locale, "en-US"} {
		t, err := s.Global.GetCapabilityTranslation(ctx, globaldb.GetCapabilityTranslationParams{
			CapabilityID: row.CapabilityID,
			Locale:       tryLocale,
		})
		if err == nil {
			displayName = t.DisplayName
			description = t.Description
			break
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			log.Error("failed to get translation", "capability_id", row.CapabilityID, "locale", tryLocale)
		}
	}

	return orgtypes.MarketplaceCapability{
		CapabilityID: row.CapabilityID,
		DisplayName:  displayName,
		Description:  description,
		Status:       orgtypes.MarketplaceCapabilityStatus(row.Status),
	}
}
