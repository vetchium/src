package org

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

func ArchiveMarketplaceListing(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.ArchiveListingRequest
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

		existing, err := s.RegionalForCtx(ctx).GetMarketplaceListingByDomainAndNumber(ctx, regionaldb.GetMarketplaceListingByDomainAndNumberParams{
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

		// Only active or suspended listings can be archived
		if existing.Status != regionaldb.MarketplaceListingStatusActive &&
			existing.Status != regionaldb.MarketplaceListingStatusSuspended {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		var archived regionaldb.MarketplaceListing

		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			a, err := qtx.ArchiveMarketplaceListing(ctx, existing.ListingID)
			if err != nil {
				return err
			}
			archived = a

			eventData, _ := json.Marshal(map[string]any{
				"listing_id":     uuidToString(archived.ListingID),
				"listing_number": archived.ListingNumber,
			})
			if err := qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_listing_archived",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			}); err != nil {
				return err
			}

			// Remove from global discovery catalog
			return s.Global.DeleteListingCatalog(ctx, archived.ListingID)
		})
		if txErr != nil {
			s.Logger(ctx).Error("failed to archive listing", "error", txErr)
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
			ListingID:             uuidToString(archived.ListingID),
			OrgDomain:             archived.OrgDomain,
			ListingNumber:         archived.ListingNumber,
			Headline:              archived.Headline,
			Description:           archived.Description,
			Capabilities:          existing.Capabilities,
			Status:                orgspec.MarketplaceListingStatus(archived.Status),
			ActiveSubscriberCount: subscriberCount,
			CreatedAt:             archived.CreatedAt.Time.Format(time.RFC3339),
			UpdatedAt:             archived.UpdatedAt.Time.Format(time.RFC3339),
		}
		if archived.SuspensionNote.Valid {
			resp.SuspensionNote = &archived.SuspensionNote.String
		}
		if archived.RejectionNote.Valid {
			resp.RejectionNote = &archived.RejectionNote.String
		}
		if archived.ListedAt.Valid {
			t := archived.ListedAt.Time.Format(time.RFC3339)
			resp.ListedAt = &t
		}
		json.NewEncoder(w).Encode(resp)
	}
}
