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

// UpgradeOrgPlan upgrades the calling org to the given plan.
// Requires org:manage_plan (or superadmin). Only self_upgradeable plans are accepted
// via this endpoint; admin can bypass via /admin/org-plan/set.
func UpgradeOrgPlan(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req orgtypes.UpgradeOrgPlanRequest
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

		var fromPlanID string
		err := s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
			sub, txErr := qtx.GetOrgPlan(ctx, orgUser.OrgID)
			if txErr != nil {
				return txErr
			}
			fromPlanID = sub.CurrentPlanID

			targetPlan, txErr := qtx.GetPlan(ctx, req.PlanID)
			if txErr != nil {
				return txErr
			}

			if !targetPlan.SelfUpgradeable {
				return server.ErrInvalidState
			}
			if req.PlanID == sub.CurrentPlanID {
				return server.ErrInvalidState
			}
			if targetPlan.DisplayOrder < sub.DisplayOrder {
				return server.ErrInvalidState
			}

			if txErr = qtx.UpdateOrgPlan(ctx, globaldb.UpdateOrgPlanParams{
				CurrentPlanID:      req.PlanID,
				UpdatedByAdminID:   pgtype.UUID{Valid: false},
				UpdatedByOrgUserID: orgUser.OrgUserID,
				Note:               "",
				OrgID:              orgUser.OrgID,
			}); txErr != nil {
				return txErr
			}

			return qtx.InsertOrgPlanHistory(ctx, globaldb.InsertOrgPlanHistoryParams{
				OrgID:              orgUser.OrgID,
				FromPlanID:         pgtype.Text{String: sub.CurrentPlanID, Valid: true},
				ToPlanID:           req.PlanID,
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
			s.Logger(ctx).Error("failed to upgrade org plan", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		// Write regional audit log (cross-DB pattern: global first, then regional)
		eventData, _ := json.Marshal(map[string]any{
			"from_plan_id": fromPlanID,
			"to_plan_id":   req.PlanID,
			"org_id":       uuidToString(orgUser.OrgID),
		})
		auditErr := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "org.plan_upgraded",
				ActorUserID: orgUser.OrgUserID,
				OrgID:       orgUser.OrgID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   eventData,
			})
		})
		if auditErr != nil {
			s.Logger(ctx).Error("CONSISTENCY_ALERT: failed to write audit log for plan upgrade", "error", auditErr, "org_id", uuidToString(orgUser.OrgID))
		}

		// Fetch updated plan for response
		sub, err := s.Global.GetOrgPlan(ctx, orgUser.OrgID)
		if err != nil {
			s.Logger(ctx).Error("failed to get updated org plan", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		org, err := s.Global.GetOrgByID(ctx, orgUser.OrgID)
		if err != nil {
			s.Logger(ctx).Error("failed to get org", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		resp, err := buildOrgPlan(ctx, sub, org.OrgName, s.Global, s.Regional)
		if err != nil {
			s.Logger(ctx).Error("failed to build plan response", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(resp)
	}
}
