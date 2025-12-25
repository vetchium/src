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
	// Note: Go 1.21+ ServeMux requires specific patterns. Using trailing slash
	// for collection endpoints and path variables for specific items.
	// Use mux.Handle for middleware-wrapped routes (returns http.Handler)
	authMiddleware := middleware.AdminAuth(s.Global)
	mux.Handle("POST /admin/approved-domains/", authMiddleware(admin.CreateApprovedDomain(s)))
	mux.Handle("GET /admin/approved-domains/", authMiddleware(admin.ListApprovedDomains(s)))
	mux.Handle("GET /admin/approved-domains/{domainName}", authMiddleware(admin.GetApprovedDomain(s)))
	mux.Handle("DELETE /admin/approved-domains/{domainName}", authMiddleware(admin.DeleteApprovedDomain(s)))
	mux.Handle("GET /admin/approved-domains/audit", authMiddleware(admin.GetAuditLogs(s)))
}
