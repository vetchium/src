package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

// ArchiveMarketplaceServiceListing handles POST /org/archive-marketplace-service-listing
func ArchiveMarketplaceServiceListing(s *server.RegionalServer) http.HandlerFunc {
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

		var req orgtypes.ArchiveMarketplaceServiceListingRequest
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

		var listingID pgtype.UUID
		if err := listingID.Scan(req.ServiceListingID); err != nil {
			log.Debug("invalid service_listing_id", "error", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}

		// Archive can be done by the org regardless of capability status,
		// so no capability check here.
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			_, txErr := qtx.ArchiveServiceListing(ctx, regionaldb.ArchiveServiceListingParams{
				ServiceListingID: listingID,
				OrgID:            orgUser.OrgID,
			})
			if txErr != nil {
				return txErr
			}

			eventData, _ := json.Marshal(map[string]any{
				"service_listing_id": req.ServiceListingID,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "marketplace.archive_service_listing",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// ArchiveServiceListing returns no rows if not found or already archived.
				// Distinguish by checking existence.
				_, getErr := s.Regional.GetServiceListingByIDAndOrg(ctx, regionaldb.GetServiceListingByIDAndOrgParams{
					ServiceListingID: listingID,
					OrgID:            orgUser.OrgID,
				})
				if getErr != nil {
					if errors.Is(getErr, pgx.ErrNoRows) {
						w.WriteHeader(http.StatusNotFound)
						return
					}
					log.Error("failed to get service listing for state check", "error", getErr)
					http.Error(w, "", http.StatusInternalServerError)
					return
				}
				// Listing exists but is in a state that cannot be archived (already archived?)
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			log.Error("failed to archive service listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		log.Info("service listing archived", "service_listing_id", req.ServiceListingID)
		w.WriteHeader(http.StatusOK)
	}
}
