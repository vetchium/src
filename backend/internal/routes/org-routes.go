package routes

import (
	"net/http"

	"backend/handlers/health"
	"backend/handlers/org"
	"backend/internal/orgsapi"
)

func RegisterOrgsRoutes(mux *http.ServeMux, s *orgsapi.Server) {
	mux.HandleFunc("GET /readyz", health.Ready(s.DB, s.Log))
	mux.HandleFunc("GET /api/org/ping", org.Ping(s))
}
