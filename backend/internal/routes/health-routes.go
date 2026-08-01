package routes

import (
	"net/http"

	"backend/handlers/health"
	"backend/internal/server"
)

func RegisterAPIHealthRoute(mux *http.ServeMux, s *server.Server) {
	mux.HandleFunc("GET /readyz", health.Ready(s))
}
