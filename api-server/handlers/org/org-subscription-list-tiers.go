package org

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgtypes "vetchium-api-server.typespec/org"
)

// ListOrgTiers returns the active tier catalog. Any authenticated org user can call this.
func ListOrgTiers(s *server.RegionalServer) http.HandlerFunc {
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

		rows, err := s.Global.ListOrgTiers(ctx, locale)
		if err != nil {
			s.Logger(ctx).Error("failed to list org tiers", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		tiers := make([]orgtypes.OrgTier, 0, len(rows))
		for _, row := range rows {
			tiers = append(tiers, buildOrgTierFromRow(row))
		}

		json.NewEncoder(w).Encode(orgtypes.ListOrgTiersResponse{Tiers: tiers})
	}
}
