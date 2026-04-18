package routes

import (
	"net/http"

	"vetchium-api-server.gomodule/handlers/admin"
	"vetchium-api-server.gomodule/handlers/public"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	adminspec "vetchium-api-server.typespec/admin"
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

	// Public unauthenticated routes (accessible to all portals)
	mux.HandleFunc("GET /public/tag-icon", public.GetTagIcon(s))

	// Create middleware instances
	adminAuth := middleware.AdminAuth(s.Global)
	adminRoleViewUsers := middleware.AdminRole(s.Global, adminspec.AdminRoleViewUsers, adminspec.AdminRoleManageUsers)
	adminRoleManageUsers := middleware.AdminRole(s.Global, adminspec.AdminRoleManageUsers)
	adminRoleViewDomains := middleware.AdminRole(s.Global, adminspec.AdminRoleViewDomains, adminspec.AdminRoleManageDomains)
	adminRoleManageDomains := middleware.AdminRole(s.Global, adminspec.AdminRoleManageDomains)
	adminRoleManageTags := middleware.AdminRole(s.Global, adminspec.AdminRoleManageTags)
	adminRoleViewAuditLogs := middleware.AdminRole(s.Global, adminspec.AdminRoleViewAuditLogs)
	adminRoleViewOrgSubscriptions := middleware.AdminRole(s.Global, adminspec.AdminRoleViewOrgSubscriptions, adminspec.AdminRoleManageOrgSubscriptions)
	adminRoleManageOrgSubscriptions := middleware.AdminRole(s.Global, adminspec.AdminRoleManageOrgSubscriptions)
	adminRoleViewMarketplace := middleware.AdminRole(s.Global, adminspec.AdminRoleViewMarketplace, adminspec.AdminRoleManageMarketplace)
	adminRoleManageMarketplace := middleware.AdminRole(s.Global, adminspec.AdminRoleManageMarketplace)

	// Auth-only routes (no role required)
	mux.Handle("POST /admin/logout", adminAuth(admin.Logout(s)))
	mux.Handle("POST /admin/set-language", adminAuth(admin.SetLanguage(s)))
	mux.Handle("POST /admin/change-password", adminAuth(admin.ChangePassword(s)))
	mux.Handle("GET /admin/myinfo", adminAuth(admin.MyInfo(s)))
	mux.Handle("POST /admin/get-tag", adminAuth(admin.GetTag(s)))
	mux.Handle("POST /admin/filter-tags", adminAuth(admin.FilterTags(s)))

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

	// Tag management routes (admin:manage_tags required)
	mux.Handle("POST /admin/add-tag", adminAuth(adminRoleManageTags(admin.AddTag(s))))
	mux.Handle("POST /admin/update-tag", adminAuth(adminRoleManageTags(admin.UpdateTag(s))))
	mux.Handle("POST /admin/upload-tag-icon", adminAuth(adminRoleManageTags(admin.UploadTagIcon(s))))
	mux.Handle("POST /admin/delete-tag-icon", adminAuth(adminRoleManageTags(admin.DeleteTagIcon(s))))

	// Audit log routes
	mux.Handle("POST /admin/filter-audit-logs", adminAuth(adminRoleViewAuditLogs(admin.FilterAuditLogs(s))))

	// Org subscription / tier management routes
	mux.Handle("POST /admin/org-subscriptions/list", adminAuth(adminRoleViewOrgSubscriptions(admin.ListOrgSubscriptions(s))))
	mux.Handle("POST /admin/org-subscriptions/set-tier", adminAuth(adminRoleManageOrgSubscriptions(admin.SetOrgTier(s))))

	// Marketplace capability management routes (admin:manage_marketplace required)
	mux.Handle("POST /admin/marketplace/capability/create", adminAuth(adminRoleManageMarketplace(admin.CreateMarketplaceCapability(s))))
	mux.Handle("POST /admin/marketplace/capability/update", adminAuth(adminRoleManageMarketplace(admin.UpdateMarketplaceCapability(s))))
	mux.Handle("POST /admin/marketplace/capability/list", adminAuth(adminRoleViewMarketplace(admin.ListMarketplaceCapabilities(s))))

	// Marketplace listing oversight routes
	mux.Handle("POST /admin/marketplace/listing/list", adminAuth(adminRoleViewMarketplace(admin.AdminListMarketplaceListings(s))))
	mux.Handle("POST /admin/marketplace/listing/suspend", adminAuth(adminRoleManageMarketplace(admin.AdminSuspendListing(s))))
	mux.Handle("POST /admin/marketplace/listing/reinstate", adminAuth(adminRoleManageMarketplace(admin.AdminReinstateListing(s))))

	// Marketplace subscription oversight routes
	mux.Handle("POST /admin/marketplace/subscription/list", adminAuth(adminRoleViewMarketplace(admin.AdminListMarketplaceSubscriptions(s))))
	mux.Handle("POST /admin/marketplace/subscription/cancel", adminAuth(adminRoleManageMarketplace(admin.AdminCancelMarketplaceSubscription(s))))

}
