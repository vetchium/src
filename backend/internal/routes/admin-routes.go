package routes

import (
	"net/http"

	"backend/handlers/admin"
	"backend/internal/server"
)

func RegisterAdminRoutes(mux *http.ServeMux, s *server.Server) {
	mux.HandleFunc("GET /api/admin/ping", admin.Ping(s))
}
