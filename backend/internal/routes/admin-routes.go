package routes

import (
	"net/http"

	"backend/handlers/admin"
	"backend/internal/adminapi"
	"backend/internal/middleware"
)

func RegisterAdminRoutes(mux *http.ServeMux, s *adminapi.Server) {
	mux.HandleFunc("GET /readyz", s.Ready)
	mux.HandleFunc("POST /api/admin/login", admin.Login(s))

	adminAuth := middleware.AdminAuth(s)
	mux.Handle("POST /api/admin/logout", adminAuth(admin.Logout(s)))
	mux.Handle("GET /api/admin/my-info", adminAuth(admin.MyInfo(s)))
}
