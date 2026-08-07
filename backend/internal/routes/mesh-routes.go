package routes

import (
	"net/http"

	"backend/handlers/mesh"
	"backend/internal/meshapi"
)

func RegisterMeshRoutes(mux *http.ServeMux, s *meshapi.Server) {
	mux.HandleFunc("POST /mesh/sync", mesh.Sync(s))
}
