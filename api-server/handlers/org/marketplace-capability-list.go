package org

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

func ListMarketplaceCapabilities(s *server.RegionalServer) http.HandlerFunc {
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

		rows, err := s.Global.ListActiveCapabilities(ctx, locale)
		if err != nil {
			s.Logger(ctx).Error("failed to list capabilities", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		caps := make([]orgspec.MarketplaceCapability, 0, len(rows))
		for _, row := range rows {
			caps = append(caps, orgspec.MarketplaceCapability{
				CapabilityID: row.CapabilityID,
				DisplayName:  row.DisplayName,
				Description:  row.Description,
				Status:       orgspec.CapabilityStatus(row.Status),
			})
		}

		json.NewEncoder(w).Encode(orgspec.ListCapabilitiesResponse{Capabilities: caps})
	}
}
