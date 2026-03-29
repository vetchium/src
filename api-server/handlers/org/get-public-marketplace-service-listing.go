package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/proxy"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

// GetPublicMarketplaceServiceListing handles POST /org/get-public-marketplace-service-listing
// Returns a publicly-visible (active) service listing for the buyer view.
// Routes to the correct region based on the org_domain's home region.
func GetPublicMarketplaceServiceListing(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		// Buffer body before decoding so we can proxy if needed
		bodyBytes, err := proxy.BufferBody(r)
		if err != nil {
			log.Debug("failed to buffer request body", "error", err)
			http.Error(w, "", http.StatusBadRequest)
			return
		}

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			log.Debug("org user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.GetPublicMarketplaceServiceListingRequest
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

		// Look up the org by domain to get org_id and region
		providerOrg, err := s.Global.GetOrgByDomain(ctx, req.OrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get org by domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Proxy to the correct region if the org's home region != current region
		if providerOrg.Region != s.CurrentRegion {
			s.ProxyToRegion(w, r, providerOrg.Region, bodyBytes)
			return
		}

		// Local region: query the active listing by org + name
		listing, err := s.Regional.GetServiceListingByOrgAndName(ctx, regionaldb.GetServiceListingByOrgAndNameParams{
			OrgID: providerOrg.OrgID,
			Name:  req.Name,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get public service listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Only active listings are publicly visible
		if listing.State != regionaldb.ServiceListingStateActive {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Prevent org from viewing its own listing via the buyer endpoint
		if listing.OrgID == orgUser.OrgID {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		json.NewEncoder(w).Encode(dbServiceListingToAPI(listing, req.OrgDomain))
	}
}
