package routes

import (
	"net/http"

	"backend/handlers/hub"
	"backend/internal/hubapi"
)

func RegisterHubRoutes(mux *http.ServeMux, s *hubapi.Server) {
	mux.HandleFunc("GET /api/hub/ping", hub.Ping(s))
}
