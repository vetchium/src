package routes

import (
	"net/http"

	"backend/handlers/health"
	"backend/handlers/mesh"
	"backend/internal/meshapi"
)

func RegisterMeshRoutes(mux *http.ServeMux, s *meshapi.Server) {
	mux.HandleFunc("GET /mesh/readyz", health.Ready(s.DB, s.Log))
	mux.HandleFunc("POST /mesh/sync", mesh.Sync(s))
}
