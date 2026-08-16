package routes

import (
	"net/http"

	"backend/handlers/mesh"
	"backend/internal/apiserver"
	"backend/internal/meshapi"
)

func RegisterMeshRoutes(mux *http.ServeMux, s *meshapi.Server) {
	mux.HandleFunc("GET /healthz", apiserver.HealthCheck)
	mux.HandleFunc("POST /mesh/sync", mesh.Sync(s))
}
