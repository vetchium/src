package routes

import (
	"net/http"

	"vetchium-api-server.gomodule/handlers/admin"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
)

func RegisterAdminRoutes(mux *http.ServeMux, s *server.Server) {
	mux.HandleFunc("POST /admin/login", admin.Login(s))
	mux.HandleFunc("POST /admin/tfa", admin.TFA(s))
	mux.HandleFunc("POST /admin/logout", admin.Logout(s))
	mux.HandleFunc("POST /admin/preferences", admin.UpdatePreferences(s))

	// Approved domains routes (require authentication)
	authMiddleware := middleware.AdminAuth(s.Global)
	mux.Handle("POST /admin/add-approved-domain", authMiddleware(admin.AddApprovedDomain(s)))
	mux.Handle("POST /admin/list-approved-domains", authMiddleware(admin.ListApprovedDomains(s)))
	mux.Handle("POST /admin/get-approved-domain", authMiddleware(admin.GetApprovedDomain(s)))
	mux.Handle("POST /admin/disable-approved-domain", authMiddleware(admin.DisableApprovedDomain(s)))
	mux.Handle("POST /admin/enable-approved-domain", authMiddleware(admin.EnableApprovedDomain(s)))
}
