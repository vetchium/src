package routes

import (
	"net/http"

	"backend/handlers/health"
	"backend/internal/server"
)

func RegisterPortalHealthRoute(mux *http.ServeMux, s *server.Server) {
	mux.HandleFunc("GET /api/readyz", health.Ready(s))
}
