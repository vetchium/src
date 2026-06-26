package hub

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"vetchium-api-server.gomodule/internal/audit"
	"vetchium-api-server.gomodule/internal/db/regionaldb"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	hubtypes "vetchium-api-server.typespec/hub"
)

// SwitchPlan switches the authenticated hub user's own plan (Spec 17).
// Display-only: there is no payment. Switching to the current plan is an
// idempotent no-op (200, no history/audit write). All writes — the plan update,
// the history row and the audit log — happen inside one regional transaction.
func SwitchPlan(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		hubUser := middleware.HubUserFromContext(ctx)
		if hubUser == nil {
			log.Debug("hub user not found in context")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		var req hubtypes.SwitchHubPlanRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.Debug("failed to decode request", "error", err)
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if errs := req.Validate(); len(errs) > 0 {
			log.Debug("validation failed", "errors", errs)
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(errs)
			return
		}

		var target regionaldb.GetHubPlanRow
		err := s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error {
			// Validate the target plan: must exist, be active and self-upgradeable.
			t, txErr := qtx.GetHubPlan(ctx, string(req.PlanID))
			if txErr != nil {
				if errors.Is(txErr, pgx.ErrNoRows) {
					return server.ErrNotFound
				}
				return txErr
			}
			target = t
			if t.Status != "active" || !t.SelfUpgradeable {
				return server.ErrInvalidState
			}

			// Read current plan; a no-op switch short-circuits with no writes.
			current, txErr := qtx.GetHubUserPlanWithCaps(ctx, hubUser.HubUserGlobalID)
			if txErr != nil {
				return txErr
			}
			if current.PlanID == string(req.PlanID) {
				return nil // idempotent no-op
			}

			if _, txErr = qtx.SwitchHubUserPlan(ctx, regionaldb.SwitchHubUserPlanParams{
				PlanID:          string(req.PlanID),
				HubUserGlobalID: hubUser.HubUserGlobalID,
			}); txErr != nil {
				return txErr
			}

			if txErr = qtx.InsertHubPlanHistory(ctx, regionaldb.InsertHubPlanHistoryParams{
				HubUserGlobalID: hubUser.HubUserGlobalID,
				FromPlanID:      pgtype.Text{String: current.PlanID, Valid: true},
				ToPlanID:        string(req.PlanID),
				Reason:          "self-switch",
			}); txErr != nil {
				return txErr
			}

			auditData, _ := json.Marshal(map[string]any{
				"from_plan_id": current.PlanID,
				"to_plan_id":   string(req.PlanID),
			})
			return qtx.InsertAuditLog(ctx, regionaldb.InsertAuditLogParams{
				EventType:   "hub.switch_plan",
				ActorUserID: hubUser.HubUserGlobalID,
				IpAddress:   audit.ExtractClientIP(r),
				EventData:   auditData,
			})
		})
		if err != nil {
			switch {
			case errors.Is(err, server.ErrNotFound):
				w.WriteHeader(http.StatusNotFound)
			case errors.Is(err, server.ErrInvalidState):
				w.WriteHeader(http.StatusUnprocessableEntity)
			default:
				log.Error("failed to switch hub plan", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
			}
			return
		}

		json.NewEncoder(w).Encode(hubtypes.HubPlanResponse{
			PlanID:                  hubtypes.HubPlanId(target.PlanID),
			CanUploadProfilePicture: target.CanUploadProfilePicture,
			CanPostMessages:         target.CanPostMessages,
		})
	}
}
