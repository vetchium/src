package org

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

// ListPlans returns the active plan catalog. Any authenticated org user can call this.
func ListPlans(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		orgUser := middleware.OrgUserFromContext(ctx)
		if orgUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		locale := orgUser.PreferredLanguage
		if locale == "" {
			locale = "en-US"
		}

		rows, err := s.Global.ListPlans(ctx, locale)
		if err != nil {
			s.Logger(ctx).Error("failed to list plans", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		plans := make([]orgtypes.Plan, 0, len(rows))
		for _, row := range rows {
			plans = append(plans, buildPlanFromRow(row))
		}

		json.NewEncoder(w).Encode(orgtypes.ListPlansResponse{Plans: plans})
	}
}
