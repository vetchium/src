package routes

import (
	"net/http"

	"backend/handlers/hub"
	"backend/internal/server"
)

func RegisterHubRoutes(mux *http.ServeMux, s *server.Server) {
	mux.HandleFunc("GET /api/hub/ping", hub.Ping(s))
}
