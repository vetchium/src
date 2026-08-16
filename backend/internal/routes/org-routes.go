package routes

import (
	"net/http"

	"backend/handlers/org"
	"backend/internal/apiserver"
	"backend/internal/orgsapi"
)

func RegisterOrgsRoutes(mux *http.ServeMux, s *orgsapi.Server) {
	mux.HandleFunc("GET /healthz", apiserver.HealthCheck)
	mux.HandleFunc("GET /api/org/ping", org.Ping(s))
}
