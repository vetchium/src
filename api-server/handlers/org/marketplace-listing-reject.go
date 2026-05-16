package org

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

// RejectListing transitions a pending_review listing back to draft with a rejection note.
// Only superadmins can reject listings.
func RejectListing(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.OrgRejectListingRequest
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

		existing, err := s.RegionalForCtx(ctx).GetMarketplaceListingByDomainAndNumber(ctx, regionaldb.GetMarketplaceListingByDomainAndNumberParams{
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

		var rejected regionaldb.MarketplaceListing

		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			rj, err := qtx.RejectMarketplaceListing(ctx, regionaldb.RejectMarketplaceListingParams{
				RejectionNote: pgtype.Text{String: req.RejectionNote, Valid: true},
				ListingID:     existing.ListingID,
			})
			if err != nil {
				return err
			}
			rejected = rj

			eventData, _ := json.Marshal(map[string]any{
				"listing_id":     uuidToString(rejected.ListingID),
				"listing_number": rejected.ListingNumber,
				"org_domain":     req.OrgDomain,
			})
			if err := qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_listing_rejected",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			}); err != nil {
				return err
			}

			return nil
		})
		if txErr != nil {
			s.Logger(ctx).Error("failed to reject listing", "error", txErr)
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
			ListingID:             uuidToString(rejected.ListingID),
			OrgDomain:             rejected.OrgDomain,
			ListingNumber:         rejected.ListingNumber,
			Headline:              rejected.Headline,
			Description:           rejected.Description,
			Capabilities:          existing.Capabilities,
			Status:                orgspec.MarketplaceListingStatus(rejected.Status),
			ActiveSubscriberCount: subscriberCount,
			CreatedAt:             rejected.CreatedAt.Time.Format(time.RFC3339),
			UpdatedAt:             rejected.UpdatedAt.Time.Format(time.RFC3339),
		}
		if rejected.SuspensionNote.Valid {
			resp.SuspensionNote = &rejected.SuspensionNote.String
		}
		if rejected.RejectionNote.Valid {
			resp.RejectionNote = &rejected.RejectionNote.String
		}
		if rejected.ListedAt.Valid {
			t := rejected.ListedAt.Time.Format(time.RFC3339)
			resp.ListedAt = &t
		}
		json.NewEncoder(w).Encode(resp)
	}
}
