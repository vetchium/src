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
	adminRoleInvite := middleware.AdminRole(s.Global, "admin:invite_users")
	adminRoleManage := middleware.AdminRole(s.Global, "admin:manage_users")
	adminRoleDomains := middleware.AdminRole(s.Global, "admin:manage_domains")
	adminRoleViewUsers := middleware.AdminRole(s.Global, "admin:invite_users", "admin:manage_users")

	// Auth-only routes (no role required)
	mux.Handle("POST /admin/logout", adminAuth(admin.Logout(s)))
	mux.Handle("POST /admin/set-language", adminAuth(admin.SetLanguage(s)))
	mux.Handle("POST /admin/change-password", adminAuth(admin.ChangePassword(s)))
	mux.Handle("GET /admin/myinfo", adminAuth(admin.MyInfo(s)))

	// Role-protected read routes
	mux.Handle("POST /admin/filter-users", adminAuth(adminRoleViewUsers(admin.FilterUsers(s))))
	mux.Handle("POST /admin/list-approved-domains", adminAuth(adminRoleDomains(admin.ListApprovedDomains(s))))
	mux.Handle("POST /admin/get-approved-domain", adminAuth(adminRoleDomains(admin.GetApprovedDomain(s))))

	// Role-protected routes
	mux.Handle("POST /admin/invite-user", adminAuth(adminRoleInvite(admin.InviteUser(s))))
	mux.Handle("POST /admin/disable-user", adminAuth(adminRoleManage(admin.DisableUser(s))))
	mux.Handle("POST /admin/enable-user", adminAuth(adminRoleManage(admin.EnableUser(s))))
	mux.Handle("POST /admin/assign-role", adminAuth(adminRoleManage(admin.AssignRole(s))))
	mux.Handle("POST /admin/remove-role", adminAuth(adminRoleManage(admin.RemoveRole(s))))
	mux.Handle("POST /admin/add-approved-domain", adminAuth(adminRoleDomains(admin.AddApprovedDomain(s))))
	mux.Handle("POST /admin/disable-approved-domain", adminAuth(adminRoleDomains(admin.DisableApprovedDomain(s))))
	mux.Handle("POST /admin/enable-approved-domain", adminAuth(adminRoleDomains(admin.EnableApprovedDomain(s))))
}
