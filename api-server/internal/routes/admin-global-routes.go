package routes

import (
	"net/http"

	"vetchium-api-server.gomodule/handlers/admin"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
)

// RegisterAdminGlobalRoutes registers admin routes on the global service.
// These routes connect only to the global database.
func RegisterAdminGlobalRoutes(mux *http.ServeMux, s *server.GlobalServer) {
	// Unauthenticated routes
	mux.HandleFunc("POST /admin/login", admin.Login(s))
	mux.HandleFunc("POST /admin/tfa", admin.TFA(s))
	mux.HandleFunc("POST /admin/complete-setup", admin.CompleteSetup(s))
	mux.HandleFunc("POST /admin/request-password-reset", admin.RequestPasswordReset(s))
	mux.HandleFunc("POST /admin/complete-password-reset", admin.CompletePasswordReset(s))

	// Create middleware instances
	adminAuth := middleware.AdminAuth(s.Global)
	adminRoleViewUsers := middleware.AdminRole(s.Global, "admin:view_users", "admin:manage_users")
	adminRoleManageUsers := middleware.AdminRole(s.Global, "admin:manage_users")
	adminRoleViewDomains := middleware.AdminRole(s.Global, "admin:view_domains", "admin:manage_domains")
	adminRoleManageDomains := middleware.AdminRole(s.Global, "admin:manage_domains")

	// Auth-only routes (no role required)
	mux.Handle("POST /admin/logout", adminAuth(admin.Logout(s)))
	mux.Handle("POST /admin/set-language", adminAuth(admin.SetLanguage(s)))
	mux.Handle("POST /admin/change-password", adminAuth(admin.ChangePassword(s)))
	mux.Handle("GET /admin/myinfo", adminAuth(admin.MyInfo(s)))

	// Role-protected read routes
	mux.Handle("POST /admin/filter-users", adminAuth(adminRoleViewUsers(admin.FilterUsers(s))))
	mux.Handle("POST /admin/list-approved-domains", adminAuth(adminRoleViewDomains(admin.ListApprovedDomains(s))))
	mux.Handle("POST /admin/get-approved-domain", adminAuth(adminRoleViewDomains(admin.GetApprovedDomain(s))))

	// Role-protected write routes
	mux.Handle("POST /admin/invite-user", adminAuth(adminRoleManageUsers(admin.InviteUser(s))))
	mux.Handle("POST /admin/disable-user", adminAuth(adminRoleManageUsers(admin.DisableUser(s))))
	mux.Handle("POST /admin/enable-user", adminAuth(adminRoleManageUsers(admin.EnableUser(s))))
	mux.Handle("POST /admin/assign-role", adminAuth(adminRoleManageUsers(admin.AssignRole(s))))
	mux.Handle("POST /admin/remove-role", adminAuth(adminRoleManageUsers(admin.RemoveRole(s))))
	mux.Handle("POST /admin/add-approved-domain", adminAuth(adminRoleManageDomains(admin.AddApprovedDomain(s))))
	mux.Handle("POST /admin/disable-approved-domain", adminAuth(adminRoleManageDomains(admin.DisableApprovedDomain(s))))
	mux.Handle("POST /admin/enable-approved-domain", adminAuth(adminRoleManageDomains(admin.EnableApprovedDomain(s))))
}
