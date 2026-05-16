package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

func GetSubscription(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.GetSubscriptionRequest
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

		// Find the listing in global catalog to get listing_id
		catalog, err := s.Global.GetListingCatalogByDomainAndNumber(ctx, globaldb.GetListingCatalogByDomainAndNumberParams{
			OrgDomain:     req.ProviderOrgDomain,
			ListingNumber: req.ProviderListingNumber,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get listing catalog", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		sub, err := s.RegionalForCtx(ctx).GetMarketplaceSubscription(ctx, regionaldb.GetMarketplaceSubscriptionParams{
			ConsumerOrgID: orgUser.OrgID,
			ListingID:     catalog.ListingID,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get subscription", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(buildSubscription(sub))
	}
}
