package routes

import (
	"net/http"

	"backend/handlers/health"
	"backend/handlers/mesh"
	"backend/internal/server"
)

func RegisterMeshRoutes(mux *http.ServeMux, s *server.Server) {
	mux.HandleFunc("GET /mesh/readyz", health.Ready(s))
	mux.HandleFunc("POST /mesh/sync", mesh.Sync(s))
}
