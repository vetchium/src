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

func ReopenMarketplaceListing(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.ReopenListingRequest
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

		// Security check: must own the listing
		if existing.OrgID != orgUser.OrgID {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		if existing.Status != regionaldb.MarketplaceListingStatusArchived {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		var reopened regionaldb.MarketplaceListing

		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			ro, err := qtx.ReopenMarketplaceListing(ctx, existing.ListingID)
			if err != nil {
				return err
			}
			reopened = ro

			eventData, _ := json.Marshal(map[string]any{
				"listing_id":     uuidToString(reopened.ListingID),
				"listing_number": reopened.ListingNumber,
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_listing_reopened",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if txErr != nil {
			s.Logger(ctx).Error("failed to reopen listing", "error", txErr)
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
			ListingID:             uuidToString(reopened.ListingID),
			OrgDomain:             reopened.OrgDomain,
			ListingNumber:         reopened.ListingNumber,
			Headline:              reopened.Headline,
			Description:           reopened.Description,
			Capabilities:          existing.Capabilities,
			Status:                orgspec.MarketplaceListingStatus(reopened.Status),
			ActiveSubscriberCount: subscriberCount,
			CreatedAt:             reopened.CreatedAt.Time.Format(time.RFC3339),
			UpdatedAt:             reopened.UpdatedAt.Time.Format(time.RFC3339),
		}
		if reopened.SuspensionNote.Valid {
			resp.SuspensionNote = &reopened.SuspensionNote.String
		}
		if reopened.RejectionNote.Valid {
			resp.RejectionNote = &reopened.RejectionNote.String
		}
		if reopened.ListedAt.Valid {
			t := reopened.ListedAt.Time.Format(time.RFC3339)
			resp.ListedAt = &t
		}
		json.NewEncoder(w).Encode(resp)
	}
}
