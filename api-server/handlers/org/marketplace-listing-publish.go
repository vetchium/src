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
	"vetchium-api-server.gomodule/internal/orgtiers"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

func PublishMarketplaceListing(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.PublishListingRequest
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

		orgRecord, err := s.Global.GetOrgByID(ctx, orgUser.OrgID)
		if err != nil {
			s.Logger(ctx).Error("failed to get org", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		existing, err := s.Regional.GetMarketplaceListingByDomainAndNumber(ctx, regionaldb.GetMarketplaceListingByDomainAndNumberParams{
			OrgDomain:     orgRecord.OrgName,
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

		if existing.Status != regionaldb.MarketplaceListingStatusDraft {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		// Enforce marketplace listing quota (counts active + pending_review)
		quotaPayload, err := orgtiers.EnforceQuota(
			ctx, orgtiers.QuotaMarketplaceListings, orgUser.OrgID, s.Global, s.Regional,
		)
		if err != nil {
			if errors.Is(err, orgtiers.ErrQuotaExceeded) {
				orgtiers.WriteQuotaError(w, quotaPayload)
				return
			}
			s.Logger(ctx).Error("failed to check quota", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Check if caller is superadmin (can publish directly to active)
		isSuperAdmin := false
		superadminRole, err := s.Regional.GetRoleByName(ctx, "org:superadmin")
		if err == nil {
			hasSA, err := s.Regional.HasOrgUserRole(ctx, regionaldb.HasOrgUserRoleParams{
				OrgUserID: orgUser.OrgUserID,
				RoleID:    superadminRole.RoleID,
			})
			if err == nil {
				isSuperAdmin = hasSA
			}
		}

		var published regionaldb.MarketplaceListing
		var capabilities []string

		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			targetStatus := regionaldb.MarketplaceListingStatusPendingReview
			if isSuperAdmin {
				targetStatus = regionaldb.MarketplaceListingStatusActive
			}

			p, err := qtx.PublishMarketplaceListing(ctx, regionaldb.PublishMarketplaceListingParams{
				Status:    targetStatus,
				ListingID: existing.ListingID,
			})
			if err != nil {
				return err
			}
			published = p

			caps, err := qtx.ListCurrentCapabilitiesForListing(ctx, published.ListingID)
			if err != nil {
				return err
			}
			capabilities = caps

			eventData, _ := json.Marshal(map[string]any{
				"listing_id":     uuidToString(published.ListingID),
				"listing_number": published.ListingNumber,
				"status":         string(published.Status),
			})
			if err := qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_listing_published",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			}); err != nil {
				return err
			}

			// If directly activated (superadmin), upsert global catalog
			if isSuperAdmin {
				now := pgtype.Timestamptz{Time: time.Now(), Valid: true}
				return s.Global.UpsertListingCatalog(ctx, globaldb.UpsertListingCatalogParams{
					ListingID:     published.ListingID,
					OrgID:         orgUser.OrgID,
					OrgDomain:     orgRecord.OrgName,
					ListingNumber: published.ListingNumber,
					Headline:      published.Headline,
					Description:   published.Description,
					CapabilityIds: capabilities,
					ListedAt:      now,
				})
			}
			return nil
		})
		if txErr != nil {
			s.Logger(ctx).Error("failed to publish listing", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(buildListingFromRow(ctx, published, capabilities, 0))
	}
}
