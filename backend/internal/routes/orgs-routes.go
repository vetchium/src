package routes

import (
	"net/http"

	"backend/handlers/portal"
	"backend/internal/apiserver"
	"backend/internal/orgsapi"
)

func RegisterOrgsRoutes(mux *http.ServeMux, s *orgsapi.Server) {
	mux.HandleFunc("GET /healthz", apiserver.HealthCheck)
	mux.HandleFunc(
		"GET /api/orgs/ping",
		portal.Ping(s.Runtime, s.Queries, "orgs", s.TenantID),
	)
}
