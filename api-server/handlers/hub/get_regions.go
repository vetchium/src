package hub

import (
	"encoding/json"
	"net/http"

	"vetchium-api-server.gomodule/internal/server"
	"vetchium-api-server.typespec/hub"
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

		response := hub.GetRegionsResponse{
			Regions: make([]hub.Region, 0, len(regions)),
		}

		for _, region := range regions {
			response.Regions = append(response.Regions, hub.Region{
				RegionCode: string(region.RegionCode),
				RegionName: region.RegionName,
			})
		}

		json.NewEncoder(w).Encode(response)
	}
}
