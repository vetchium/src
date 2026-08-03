package routes

import (
	"net/http"

	"backend/handlers/org"
	"backend/internal/orgsapi"
)

func RegisterOrgsRoutes(mux *http.ServeMux, s *orgsapi.Server) {
	mux.HandleFunc("GET /readyz", s.Ready)
	mux.HandleFunc("GET /api/org/ping", org.Ping(s))
}
