package org

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

// SelfUpgradeOrgSubscription upgrades the calling org to the given tier.
// Requires org:manage_subscription (or superadmin). Only self_upgradeable tiers are accepted
// via this endpoint; admin can bypass via /admin/org-subscriptions/set-tier.
func SelfUpgradeOrgSubscription(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.SelfUpgradeOrgSubscriptionRequest
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

		var fromTierID string
		err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			sub, txErr := qtx.GetOrgSubscription(ctx, orgUser.OrgID)
			if txErr != nil {
				return txErr
			}
			fromTierID = sub.CurrentTierID

			targetTier, txErr := qtx.GetOrgTier(ctx, req.TierID)
			if txErr != nil {
				return txErr
			}

			if !targetTier.SelfUpgradeable {
				return server.ErrInvalidState
			}
			if req.TierID == sub.CurrentTierID {
				return server.ErrInvalidState
			}
			if targetTier.DisplayOrder < sub.DisplayOrder {
				return server.ErrInvalidState
			}

			if txErr = qtx.UpdateOrgSubscriptionTier(ctx, globaldb.UpdateOrgSubscriptionTierParams{
				CurrentTierID:      req.TierID,
				UpdatedByAdminID:   pgtype.UUID{Valid: false},
				UpdatedByOrgUserID: orgUser.OrgUserID,
				Note:               "",
				OrgID:              orgUser.OrgID,
			}); txErr != nil {
				return txErr
			}

			return qtx.InsertOrgSubscriptionHistory(ctx, globaldb.InsertOrgSubscriptionHistoryParams{
				OrgID:              orgUser.OrgID,
				FromTierID:         pgtype.Text{String: sub.CurrentTierID, Valid: true},
				ToTierID:           req.TierID,
				ChangedByAdminID:   pgtype.UUID{Valid: false},
				ChangedByOrgUserID: orgUser.OrgUserID,
				Reason:             "self-upgrade",
			})
		})
		if err != nil {
			if errors.Is(err, server.ErrInvalidState) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				return
			}
			s.Logger(ctx).Error("failed to upgrade org subscription", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Write regional audit log (cross-DB pattern: global first, then regional)
		eventData, _ := json.Marshal(map[string]any{
			"from_tier_id": fromTierID,
			"to_tier_id":   req.TierID,
			"org_id":       uuidToString(orgUser.OrgID),
		})
		auditErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.subscription_tier_upgraded",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if auditErr != nil {
			s.Logger(ctx).Error("CONSISTENCY_ALERT: failed to write audit log for tier upgrade", "error", auditErr, "org_id", uuidToString(orgUser.OrgID))
		}

		// Fetch updated subscription for response
		sub, err := s.Global.GetOrgSubscription(ctx, orgUser.OrgID)
		if err != nil {
			s.Logger(ctx).Error("failed to get updated org subscription", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		org, err := s.Global.GetOrgByID(ctx, orgUser.OrgID)
		if err != nil {
			s.Logger(ctx).Error("failed to get org", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		resp, err := buildOrgSubscription(ctx, sub, org.OrgName, s.Global, s.Regional)
		if err != nil {
			s.Logger(ctx).Error("failed to build subscription response", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(resp)
	}
}
