package admin

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

func AdminSuspendListing(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.AdminSuspendListingRequest
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

		// Look up listing in catalog to get region
		catalog, err := s.Global.GetListingCatalogByDomainAndNumber(ctx, globaldb.GetListingCatalogByDomainAndNumberParams{
			OrgDomain:     req.OrgDomain,
			ListingNumber: req.ListingNumber,
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

		// Get provider org region
		providerOrg, err := s.Global.GetOrgByID(ctx, catalog.OrgID)
		if err != nil {
			s.Logger(ctx).Error("failed to get provider org", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		regionalDB := s.GetRegionalDB(providerOrg.Region)
		if regionalDB == nil {
			s.Logger(ctx).Error("unknown region", "region", providerOrg.Region)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Get listing from regional DB
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

		if listing.Status != regionaldb.MarketplaceListingStatusActive {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		eventData, _ := json.Marshal(map[string]any{
			"listing_id":     uuidToString(listing.ListingID),
			"org_domain":     req.OrgDomain,
			"listing_number": req.ListingNumber,
		})

		var suspended regionaldb.MarketplaceListing

		txErr := s.WithRegionalTx(ctx, providerOrg.Region, func(qtx *regionaldb.Queries) error {
			s2, err := qtx.SuspendMarketplaceListing(ctx, regionaldb.SuspendMarketplaceListingParams{
				SuspensionNote: pgtype.Text{String: req.SuspensionNote, Valid: true},
				ListingID:      listing.ListingID,
			})
			if err != nil {
				return err
			}
			suspended = s2
			return nil
		})
		if txErr != nil {
			s.Logger(ctx).Error("failed to suspend listing", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Remove from global catalog
		if err := s.Global.DeleteListingCatalog(ctx, listing.ListingID); err != nil {
			s.Logger(ctx).Error("CONSISTENCY_ALERT: failed to remove listing from catalog after suspend", "error", err)
		}

		// Audit log in global DB
		if err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.marketplace_listing_suspended",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			s.Logger(ctx).Error("failed to write audit log", "error", err)
		}

		caps, _ := regionalDB.ListCurrentCapabilitiesForListing(ctx, suspended.ListingID)
		suspNote := suspended.SuspensionNote.String
		json.NewEncoder(w).Encode(orgspec.MarketplaceListing{
			ListingID:             uuidToString(suspended.ListingID),
			OrgDomain:             req.OrgDomain,
			ListingNumber:         suspended.ListingNumber,
			Headline:              suspended.Headline,
			Description:           suspended.Description,
			Capabilities:          caps,
			Status:                orgspec.MarketplaceListingStatusSuspended,
			SuspensionNote:        &suspNote,
			ActiveSubscriberCount: 0,
			CreatedAt:             suspended.CreatedAt.Time.Format(time.RFC3339),
			UpdatedAt:             suspended.UpdatedAt.Time.Format(time.RFC3339),
		})
	}
}
