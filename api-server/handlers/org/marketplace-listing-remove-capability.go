package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

func RemoveListingCapability(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.RemoveListingCapabilityRequest
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

		// Only draft and active listings are editable
		if existing.Status != regionaldb.MarketplaceListingStatusDraft &&
			existing.Status != regionaldb.MarketplaceListingStatusActive {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		var updated regionaldb.MarketplaceListing
		var capabilities []string

		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			// Check last-capability constraint (422)
			count, txErr := qtx.CountCurrentCapabilitiesForListing(ctx, existing.ListingID)
			if txErr != nil {
				return txErr
			}
			if count <= 1 {
				return server.ErrInvalidState
			}

			if txErr := qtx.RemoveListingCapability(ctx, regionaldb.RemoveListingCapabilityParams{
				ListingID:    existing.ListingID,
				CapabilityID: req.CapabilityID,
			}); txErr != nil {
				return txErr
			}

			caps, txErr := qtx.ListCurrentCapabilitiesForListing(ctx, existing.ListingID)
			if txErr != nil {
				return txErr
			}
			capabilities = caps
			updated = existing

			eventData, _ := json.Marshal(map[string]any{
				"listing_id":     uuidToString(existing.ListingID),
				"listing_number": existing.ListingNumber,
				"capability_id":  req.CapabilityID,
			})
			if txErr := qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_listing_updated",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			}); txErr != nil {
				return txErr
			}

			// If active, update global catalog
			if existing.Status == regionaldb.MarketplaceListingStatusActive {
				return s.Global.UpsertListingCatalog(ctx, globaldb.UpsertListingCatalogParams{
					ListingID:     existing.ListingID,
					OrgID:         orgUser.OrgID,
					OrgDomain:     orgRecord.OrgName,
					ListingNumber: existing.ListingNumber,
					Headline:      existing.Headline,
					Description:   existing.Description,
					CapabilityIds: capabilities,
					ListedAt:      existing.ListedAt,
				})
			}
			return nil
		})
		if txErr != nil {
			if errors.Is(txErr, server.ErrInvalidState) {
				s.Logger(ctx).Debug("cannot remove last capability", "listing_id", uuidToString(existing.ListingID))
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			s.Logger(ctx).Error("failed to remove capability", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(buildListingFromRow(ctx, updated, capabilities, 0, false))
	}
}
