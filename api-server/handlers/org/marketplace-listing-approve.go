package org

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

// ApproveListing transitions a pending_review listing to active.
// Only superadmins can approve listings.
func ApproveListing(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.AdminApproveListingRequest
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

		existing, err := s.Regional.GetMarketplaceListingByDomainAndNumber(ctx, regionaldb.GetMarketplaceListingByDomainAndNumberParams{
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

		if existing.Status != regionaldb.MarketplaceListingStatusPendingReview {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		var approved regionaldb.MarketplaceListing
		var capabilities []string
		now := pgtype.Timestamptz{Time: time.Now(), Valid: true}

		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			a, err := qtx.PublishMarketplaceListing(ctx, regionaldb.PublishMarketplaceListingParams{
				Status:    regionaldb.MarketplaceListingStatusActive,
				ListingID: existing.ListingID,
			})
			if err != nil {
				return err
			}
			approved = a

			caps, err := qtx.ListCurrentCapabilitiesForListing(ctx, approved.ListingID)
			if err != nil {
				return err
			}
			capabilities = caps

			eventData, _ := json.Marshal(map[string]any{
				"listing_id":     uuidToString(approved.ListingID),
				"listing_number": approved.ListingNumber,
				"org_domain":     req.OrgDomain,
			})
			if err := qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_listing_approved",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			}); err != nil {
				return err
			}

			return s.Global.UpsertListingCatalog(ctx, globaldb.UpsertListingCatalogParams{
				ListingID:     approved.ListingID,
				OrgID:         existing.OrgID,
				OrgDomain:     req.OrgDomain,
				ListingNumber: approved.ListingNumber,
				Headline:      approved.Headline,
				Description:   approved.Description,
				CapabilityIds: capabilities,
				ListedAt:      now,
			})
		})
		if txErr != nil {
			s.Logger(ctx).Error("failed to approve listing", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(buildListingFromRow(ctx, approved, capabilities, 0, false))
	}
}
