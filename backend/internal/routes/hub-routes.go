package routes

import (
	"net/http"

	"backend/handlers/health"
	"backend/handlers/hub"
	"backend/internal/hubapi"
)

func RegisterHubRoutes(mux *http.ServeMux, s *hubapi.Server) {
	mux.HandleFunc("GET /readyz", health.Ready(s.DB, s.Log))
	mux.HandleFunc("GET /api/hub/ping", hub.Ping(s))
}
