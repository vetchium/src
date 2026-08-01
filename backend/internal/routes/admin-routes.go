package routes

import (
	"net/http"

	"backend/handlers/admin"
	"backend/internal/middleware"
	"backend/internal/server"
)

func RegisterAdminRoutes(mux *http.ServeMux, s *server.Server) {
	mux.HandleFunc("POST /api/admin/login", admin.Login(s))

	adminAuth := middleware.AdminAuth(s)
	mux.Handle("POST /api/admin/logout", adminAuth(admin.Logout(s)))
	mux.Handle("GET /api/admin/my-info", adminAuth(admin.MyInfo(s)))
}
