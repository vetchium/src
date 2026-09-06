package routes

import (
	"net/http"

	"backend/handlers/mesh"
	"backend/handlers/regions"
	"backend/internal/apiserver"
	"backend/internal/meshapi"
)

func RegisterMeshRoutes(mux *http.ServeMux, s *meshapi.Server) {
	mux.HandleFunc("GET /healthz", apiserver.HealthCheck)
	mux.HandleFunc("POST /mesh/list-signup-regions", regions.Handler(s.Runtime, s.Regions, s.RegionDirectory, s.Credential))
	mux.HandleFunc("POST /mesh/sync", mesh.Sync(s))
}
