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

const defaultClientLimit = 20
const maxClientLimit = 100

// ListClients handles POST /org/marketplace/clients/list
// Returns subscriptions where the caller is the provider, using the global subscription index.
func ListClients(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.ListClientsRequest
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

		limit := int32(defaultClientLimit)
		if req.Limit != nil && *req.Limit > 0 {
			if int32(*req.Limit) < maxClientLimit {
				limit = int32(*req.Limit)
			} else {
				limit = maxClientLimit
			}
		}

		params := globaldb.ListSubscriptionIndexByProviderParams{
			ProviderOrgGlobalID: orgUser.OrgID,
			LimitCount:          limit + 1,
		}
		if req.PaginationKey != nil && *req.PaginationKey != "" {
			params.PaginationKey = parseListingUUID(*req.PaginationKey)
		}
		if req.ListingID != nil && *req.ListingID != "" {
			params.FilterListingID = parseListingUUID(*req.ListingID)
		}
		if req.FilterStatus != nil {
			params.FilterStatus = pgtype.Text{String: string(*req.FilterStatus), Valid: true}
		}

		indexRows, err := s.Global.ListSubscriptionIndexByProvider(ctx, params)
		if err != nil {
			log.Error("failed to list subscription index", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		hasMore := len(indexRows) > int(limit)
		if hasMore {
			indexRows = indexRows[:limit]
		}

		clients := make([]orgtypes.MarketplaceClient, 0, len(indexRows))
		for _, row := range indexRows {
			clients = append(clients, indexEntryToClient(row))
		}

		var nextKey *string
		if hasMore && len(indexRows) > 0 {
			last := uuidToString(indexRows[len(indexRows)-1].SubscriptionID)
			nextKey = &last
		}

		json.NewEncoder(w).Encode(orgtypes.ListClientsResponse{
			Clients:           clients,
			NextPaginationKey: nextKey,
		})
	}
}

// GetClient handles POST /org/marketplace/clients/get
// Returns a specific subscription where the caller is the provider.
func GetClient(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.GetClientRequest
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

		subUUID := parseListingUUID(req.SubscriptionID)
		if !subUUID.Valid {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Verify ownership via global index: provider must match.
		indexEntry, err := s.Global.GetSubscriptionIndexEntry(ctx, subUUID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get subscription index entry", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		if indexEntry.ProviderOrgGlobalID != orgUser.OrgID {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		json.NewEncoder(w).Encode(indexEntryToClient(indexEntry))
	}
}

// indexEntryToClient converts a global subscription index entry to the MarketplaceClient API type.
// RequestNote and ExpiresAt are not stored in the global index so they are omitted.
func indexEntryToClient(row globaldb.MarketplaceSubscriptionIndex) orgtypes.MarketplaceClient {
	return orgtypes.MarketplaceClient{
		SubscriptionID:    uuidToString(row.SubscriptionID),
		ListingID:         uuidToString(row.ListingID),
		ConsumerOrgDomain: row.ConsumerOrgDomain,
		CapabilityID:      row.CapabilityID,
		Status:            orgtypes.MarketplaceSubscriptionStatus(row.Status),
		StartedAt:         row.StartedAt.Time.UTC().Format(time.RFC3339),
		CreatedAt:         row.CreatedAt.Time.UTC().Format(time.RFC3339),
	}
}
