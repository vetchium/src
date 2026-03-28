package admin

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	admintypes "vetchium-api-server.typespec/admin"
)

// ReinstateMarketplaceServiceListing handles POST /admin/reinstate-marketplace-service-listing
// Reinstates a suspended service listing back to active (WHERE state = 'suspended').
func ReinstateMarketplaceServiceListing(s *server.GlobalServer) http.HandlerFunc {
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

		var req admintypes.AdminReinstateMarketplaceServiceListingRequest
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

		var adminNote pgtype.Text
		if req.AdminNote != nil {
			adminNote = pgtype.Text{String: *req.AdminNote, Valid: true}
		}

		var updatedListing regionaldb.MarketplaceServiceListing
		err := s.WithRegionalTx(ctx, region, func(qtx *regionaldb.Queries) error {
			var txErr error
			updatedListing, txErr = qtx.AdminReinstateServiceListing(ctx, regionaldb.AdminReinstateServiceListingParams{
				AdminID:          adminUser.AdminUserID,
				AdminNote:        adminNote,
				ServiceListingID: serviceListingID,
			})
			return txErr
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				rdb := s.GetRegionalDB(region)
				if rdb == nil {
					http.Error(w, "", http.StatusInternalServerError)
					return
				}
				_, checkErr := rdb.GetServiceListingByID(ctx, serviceListingID)
				if errors.Is(checkErr, pgx.ErrNoRows) {
					w.WriteHeader(http.StatusNotFound)
				} else {
					w.WriteHeader(http.StatusUnprocessableEntity)
				}
				return
			}
			log.Error("failed to reinstate service listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		eventData, _ := json.Marshal(map[string]any{
			"service_listing_id": req.ServiceListingID,
			"home_region":        req.HomeRegion,
		})
		auditErr := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.reinstate_marketplace_service_listing",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if auditErr != nil {
			log.Error("CONSISTENCY_ALERT: failed to write audit log after successful service listing reinstatement",
				"error", auditErr, "service_listing_id", req.ServiceListingID)
		}

		log.Info("marketplace service listing reinstated", "service_listing_id", req.ServiceListingID, "admin_id", uuidToString(adminUser.AdminUserID))

		if err := json.NewEncoder(w).Encode(adminDbServiceListingToAPI(updatedListing)); err != nil {
			log.Error("failed to encode response", "error", err)
		}
	}
}
