package admin

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

func AdminCancelMarketplaceSubscription(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgspec.AdminCancelSubscriptionRequest
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

		// Look up subscription in global index to find consumer region
		// The subscription ID exists in the subscription index
		// We need to find the consumer region to cancel in the right regional DB
		// For simplicity, iterate all regions to find the subscription
		var cancelledSub *regionaldb.MarketplaceSubscription
		var cancelledInRegion globaldb.Region

		for _, region := range s.AllRegions() {
			rdb := s.GetRegionalDB(region)
			if rdb == nil {
				continue
			}
			sub, err := rdb.GetMarketplaceSubscriptionByID(ctx, subID)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					continue
				}
				s.Logger(ctx).Error("failed to query subscription", "region", region, "error", err)
				continue
			}
			cancelledSub = &sub
			cancelledInRegion = region
			break
		}

		if cancelledSub == nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		if cancelledSub.Status != regionaldb.MarketplaceSubscriptionStatusActive {
			w.WriteHeader(http.StatusUnprocessableEntity)
			return
		}

		eventData, _ := json.Marshal(map[string]any{
			"subscription_id": req.SubscriptionID,
		})

		var cancelled regionaldb.MarketplaceSubscription
		txErr := s.WithRegionalTx(ctx, cancelledInRegion, func(qtx *regionaldb.Queries) error {
			c, err := qtx.CancelMarketplaceSubscription(ctx, subID)
			if err != nil {
				return err
			}
			cancelled = c
			return nil
		})
		if txErr != nil {
			s.Logger(ctx).Error("failed to cancel subscription", "error", txErr)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Update global subscription index
		if err := s.Global.UpdateSubscriptionIndexStatus(ctx, globaldb.UpdateSubscriptionIndexStatusParams{
			SubscriptionID: cancelled.SubscriptionID,
			Status:         string(cancelled.Status),
		}); err != nil {
			s.Logger(ctx).Error("CONSISTENCY_ALERT: failed to update subscription index", "error", err)
		}

		// Audit log
		if err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			return qtx.InsertAdminAuditLog(ctx, globaldb.InsertAdminAuditLogParams{
				EventType:   "admin.marketplace_subscription_cancelled",
				ActorUserID: adminUser.AdminUserID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		}); err != nil {
			s.Logger(ctx).Error("failed to write audit log", "error", err)
		}

		json.NewEncoder(w).Encode(map[string]string{"subscription_id": req.SubscriptionID, "status": string(cancelled.Status)})
	}
}
