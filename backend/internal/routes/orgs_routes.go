package routes

import (
	"net/http"

	"backend/handlers/portal"
	"backend/internal/apiserver"
	orgsruntime "backend/internal/orgs"
)

func RegisterOrgsRoutes(mux *http.ServeMux, s *orgsruntime.Server) {
	mux.HandleFunc("GET /healthz", apiserver.HealthCheck)
	mux.HandleFunc(
		"GET /api/orgs/ping",
		portal.Ping(s.Runtime, s.Queries, "orgs", s.TenantID),
	)
}
