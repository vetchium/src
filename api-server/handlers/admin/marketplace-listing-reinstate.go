package admin

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

func AdminReinstateListing(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.AdminReinstateListingRequest
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

		// Look up provider org by domain to get region
		providerOrgDomain, err := s.Global.GetGlobalOrgDomain(ctx, req.OrgDomain)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get org domain", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		providerOrg, err := s.Global.GetOrgByID(ctx, providerOrgDomain.OrgID)
		if err != nil {
			s.Logger(ctx).Error("failed to get provider org", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		regionalDB := s.GetRegionalDB(providerOrg.Region)
		if regionalDB == nil {
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		listing, err := regionalDB.GetMarketplaceListingByDomainAndNumber(ctx, regionaldb.GetMarketplaceListingByDomainAndNumberParams{
			OrgDomain:     req.OrgDomain,
			ListingNumber: req.ListingNumber,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get listing", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		if listing.Status != regionaldb.MarketplaceListingStatusSuspended {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		eventData, _ := json.Marshal(map[string]any{
			"listing_id":     uuidToString(listing.ListingID),
			"org_domain":     req.OrgDomain,
			"listing_number": req.ListingNumber,
		})

		var reinstated regionaldb.MarketplaceListing

		txErr := s.WithRegionalTx(ctx, providerOrg.Region, func(qtx *regionaldb.Queries) error {
			r2, err := qtx.ReinstateMarketplaceListing(ctx, listing.ListingID)
			if err != nil {
				return err
			}
			reinstated = r2
			return nil
		})
		if txErr != nil {
			s.Logger(ctx).Error("failed to reinstate listing", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Re-add to global catalog
		caps, _ := regionalDB.ListCurrentCapabilitiesForListing(ctx, reinstated.ListingID)
		if err := s.Global.UpsertListingCatalog(ctx, globaldb.UpsertListingCatalogParams{
			ListingID:     reinstated.ListingID,
			OrgID:         providerOrgDomain.OrgID,
			OrgDomain:     req.OrgDomain,
			ListingNumber: reinstated.ListingNumber,
			Headline:      reinstated.Headline,
			Description:   reinstated.Description,
			CapabilityIds: caps,
			ListedAt:      reinstated.ListedAt,
		}); err != nil {
			s.Logger(ctx).Error("CONSISTENCY_ALERT: failed to re-add listing to catalog after reinstate", "error", err)
		}

		if err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.marketplace_listing_reinstated",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			s.Logger(ctx).Error("failed to write audit log", "error", err)
		}

		subscriberCount, err := s.Global.GetActiveSubscriberCountByListingID(ctx, reinstated.ListingID)
		if err != nil {
			s.Logger(ctx).Error("failed to get subscriber count", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(orgspec.MarketplaceListing{
			ListingID:             uuidToString(reinstated.ListingID),
			OrgDomain:             req.OrgDomain,
			ListingNumber:         reinstated.ListingNumber,
			Headline:              reinstated.Headline,
			Description:           reinstated.Description,
			Capabilities:          caps,
			Status:                orgspec.MarketplaceListingStatusActive,
			ActiveSubscriberCount: subscriberCount,
			CreatedAt:             reinstated.CreatedAt.Time.Format(time.RFC3339),
			UpdatedAt:             reinstated.UpdatedAt.Time.Format(time.RFC3339),
		})
	}
}
