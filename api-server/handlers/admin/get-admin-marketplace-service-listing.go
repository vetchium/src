package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	admintypes "vetchium-api-server.typespec/admin"
)

// AdminGetMarketplaceServiceListing handles POST /admin/get-marketplace-service-listing
func AdminGetMarketplaceServiceListing(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.AdminGetMarketplaceServiceListingRequest
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

		var serviceListingID pgtype.UUID
		if err := serviceListingID.Scan(req.ServiceListingID); err != nil {
			log.Debug("invalid service_listing_id", "error", err)
			http.Error(w, "invalid service_listing_id", http.StatusBadRequest)
			return
		}

		region := globaldb.Region(req.HomeRegion)
		rdb := s.GetRegionalDB(region)
		if rdb == nil {
			log.Debug("unknown home_region", "region", req.HomeRegion)
			w.WriteHeader(http.StatusNotFound)
			return
		}

		sl, err := rdb.GetServiceListingByID(ctx, serviceListingID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			log.Error("failed to get service listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if err := json.NewEncoder(w).Encode(adminDbServiceListingToAPI(sl)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}
