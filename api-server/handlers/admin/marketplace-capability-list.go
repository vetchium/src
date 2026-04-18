package admin

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

func ListMarketplaceCapabilities(s *server.GlobalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		adminUser := middleware.AdminUserFromContext(ctx)
		if adminUser == nil {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		rows, err := s.Global.ListAllCapabilities(ctx, "en-US")
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
