package global

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/global"
)

func GetRegions(s *server.RegionalServer) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		regions, err := s.Global.GetActiveRegions(ctx)
		if err != nil {
			s.Logger(ctx).Error("failed to get active regions", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		response := global.GetRegionsResponse{
			Regions: make([]global.Region, 0, len(regions)),
		}

		for _, region := range regions {
			response.Regions = append(response.Regions, global.Region{
				RegionCode: string(region.RegionCode),
				RegionName: region.RegionName,
			})
		}

		json.NewEncoder(w).Encode(response)
	}
}
