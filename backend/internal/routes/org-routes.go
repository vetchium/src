package routes

import (
	"net/http"

	"backend/handlers/org"
	"backend/internal/server"
)

func RegisterOrgsRoutes(mux *http.ServeMux, s *server.Server) {
	mux.HandleFunc("GET /api/org/ping", org.Ping(s))
}
