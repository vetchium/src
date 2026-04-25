package org

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

func AddListingCapability(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.AddListingCapabilityRequest
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

		// Validate capability exists and is active
		count, err := s.Global.CapabilityExists(ctx, req.CapabilityID)
		if err != nil {
			s.Logger(ctx).Error("failed to check capability", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		if count == 0 {
			writeCapabilityError(w, req.CapabilityID)
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

		// Security check: must own the listing
		if existing.OrgID != orgUser.OrgID {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		// Only draft and active listings are editable
		if existing.Status != regionaldb.MarketplaceListingStatusDraft &&
			existing.Status != regionaldb.MarketplaceListingStatusActive {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		var capabilities []string

		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			if err := qtx.AddListingCapability(ctx, regionaldb.AddListingCapabilityParams{
				ListingID:    existing.ListingID,
				CapabilityID: req.CapabilityID,
			}); err != nil {
				return err
			}

			caps, err := qtx.ListCurrentCapabilitiesForListing(ctx, existing.ListingID)
			if err != nil {
				return err
			}
			capabilities = caps

			eventData, _ := json.Marshal(map[string]any{
				"listing_id":     uuidToString(existing.ListingID),
				"listing_number": existing.ListingNumber,
				"capability_id":  req.CapabilityID,
			})
			if err := qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_listing_updated",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			}); err != nil {
				return err
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
			s.Logger(ctx).Error("failed to add capability", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		subscriberCount, err := s.Global.GetActiveSubscriberCountByListingID(ctx, existing.ListingID)
		if err != nil {
			s.Logger(ctx).Error("failed to get subscriber count", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		resp := orgspec.MarketplaceListing{
			ListingID:             uuidToString(existing.ListingID),
			OrgDomain:             existing.OrgDomain,
			ListingNumber:         existing.ListingNumber,
			Headline:              existing.Headline,
			Description:           existing.Description,
			Capabilities:          capabilities,
			Status:                orgspec.MarketplaceListingStatus(existing.Status),
			ActiveSubscriberCount: subscriberCount,
			CreatedAt:             existing.CreatedAt.Time.Format(time.RFC3339),
			UpdatedAt:             existing.UpdatedAt.Time.Format(time.RFC3339),
		}
		if existing.SuspensionNote.Valid {
			resp.SuspensionNote = &existing.SuspensionNote.String
		}
		if existing.RejectionNote.Valid {
			resp.RejectionNote = &existing.RejectionNote.String
		}
		if existing.ListedAt.Valid {
			t := existing.ListedAt.Time.Format(time.RFC3339)
			resp.ListedAt = &t
		}
		json.NewEncoder(w).Encode(resp)
	}
}
