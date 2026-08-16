package routes

import (
	"net/http"

	"backend/handlers/hub"
	"backend/internal/apiserver"
	"backend/internal/hubapi"
)

func RegisterHubRoutes(mux *http.ServeMux, s *hubapi.Server) {
	mux.HandleFunc("GET /healthz", apiserver.HealthCheck)
	mux.HandleFunc("GET /api/hub/ping", hub.Ping(s))
}
