package hub

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	hubtypes "vetchium-api-server.typespec/hub"
)

// ListPlans returns the active hub plan catalog. Any authenticated hub user can
// call this. The catalog is bounded (a handful of plans), so it is returned
// un-paginated — an explicit, documented exception to keyset pagination (Spec 17).
func ListPlans(s *server.RegionalServer) http.HandlerFunc {
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

		rows, err := s.RegionalForCtx(ctx).ListHubPlans(ctx)
		if err != nil {
			log.Error("failed to list hub plans", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		plans := make([]hubtypes.HubPlan, 0, len(rows))
		for _, row := range rows {
			plans = append(plans, hubtypes.HubPlan{
				PlanID:                  hubtypes.HubPlanId(row.PlanID),
				DisplayOrder:            row.DisplayOrder,
				CanUploadProfilePicture: row.CanUploadProfilePicture,
				CanPostMessages:         row.CanPostMessages,
				SelfUpgradeable:         row.SelfUpgradeable,
			})
		}

		json.NewEncoder(w).Encode(hubtypes.ListHubPlansResponse{Plans: plans})
	}
}
