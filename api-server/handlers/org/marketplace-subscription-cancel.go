package org

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
	orgspec "vetchium-api-server.typespec/org"
)

func CancelSubscription(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.CancelSubscriptionRequest
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

		var subID pgtype.UUID
		if err := subID.Scan(req.SubscriptionID); err != nil {
			http.Error(w, "invalid subscription_id", http.StatusBadRequest)
			return
		}

		existing, err := s.RegionalForCtx(ctx).GetMarketplaceSubscriptionByID(ctx, subID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s.Logger(ctx).Error("failed to get subscription", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Verify ownership (consumer must be the calling org)
		if existing.ConsumerOrgID != orgUser.OrgID {
			w.WriteHeader(http.StatusForbidden)
			return
		}

		if existing.Status != regionaldb.MarketplaceSubscriptionStatusActive {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		var cancelled regionaldb.MarketplaceSubscription

		txErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			c, err := qtx.CancelMarketplaceSubscription(ctx, subID)
			if err != nil {
				return err
			}
			cancelled = c

			eventData, _ := json.Marshal(map[string]any{
				"subscription_id": uuidToString(cancelled.SubscriptionID),
			})
			if err := qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.marketplace_subscription_cancelled",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			}); err != nil {
				return err
			}

			// Update global subscription index
			if err := s.Global.UpdateSubscriptionIndexStatus(ctx, globaldb.UpdateSubscriptionIndexStatusParams{
				SubscriptionID: cancelled.SubscriptionID,
				Status:         string(cancelled.Status),
			}); err != nil {
				s.Logger(ctx).Error("CONSISTENCY_ALERT: failed to update subscription index", "error", err)
			}

			return nil
		})
		if txErr != nil {
			s.Logger(ctx).Error("failed to cancel subscription", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(buildSubscription(cancelled))
	}
}
