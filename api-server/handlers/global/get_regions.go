package global

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/global"
)

func GetRegions(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()
		log := s.Logger(ctx)

		regions, err := s.Global.GetActiveRegions(ctx)
		if err != nil {
			log.Error("failed to query active regions", "error", err)
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
