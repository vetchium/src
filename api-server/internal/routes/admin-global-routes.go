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

	adminRoleViewMarketplace := middleware.AdminRole(s.Global, adminspec.AdminRoleViewMarketplace, adminspec.AdminRoleManageMarketplace)

	// Marketplace capability management routes
	mux.Handle("POST /admin/marketplace/capabilities/list", adminAuth(adminRoleViewMarketplace(admin.AdminListCapabilities(s))))
	mux.Handle("POST /admin/marketplace/capabilities/get", adminAuth(adminRoleViewMarketplace(admin.AdminGetCapability(s))))
	mux.Handle("POST /admin/marketplace/capabilities/create", adminAuth(adminRoleManageMarketplace(admin.AdminCreateCapability(s))))
	mux.Handle("POST /admin/marketplace/capabilities/update", adminAuth(adminRoleManageMarketplace(admin.AdminUpdateCapability(s))))
	mux.Handle("POST /admin/marketplace/capabilities/enable", adminAuth(adminRoleManageMarketplace(admin.AdminEnableCapability(s))))
	mux.Handle("POST /admin/marketplace/capabilities/disable", adminAuth(adminRoleManageMarketplace(admin.AdminDisableCapability(s))))

	// Marketplace enrollment management routes
	mux.Handle("POST /admin/marketplace/provider-enrollments/list", adminAuth(adminRoleViewMarketplace(admin.AdminListEnrollments(s))))
	mux.Handle("POST /admin/marketplace/provider-enrollments/get", adminAuth(adminRoleViewMarketplace(admin.AdminGetEnrollment(s))))
	mux.Handle("POST /admin/marketplace/provider-enrollments/approve", adminAuth(adminRoleManageMarketplace(admin.AdminApproveEnrollment(s))))
	mux.Handle("POST /admin/marketplace/provider-enrollments/reject", adminAuth(adminRoleManageMarketplace(admin.AdminRejectEnrollment(s))))
	mux.Handle("POST /admin/marketplace/provider-enrollments/suspend", adminAuth(adminRoleManageMarketplace(admin.AdminSuspendEnrollment(s))))
	mux.Handle("POST /admin/marketplace/provider-enrollments/reinstate", adminAuth(adminRoleManageMarketplace(admin.AdminReinstateEnrollment(s))))
	mux.Handle("POST /admin/marketplace/provider-enrollments/renew", adminAuth(adminRoleManageMarketplace(admin.AdminRenewEnrollment(s))))

	// Marketplace offer management routes
	mux.Handle("POST /admin/marketplace/provider-offers/list", adminAuth(adminRoleViewMarketplace(admin.AdminListOffers(s))))
	mux.Handle("POST /admin/marketplace/provider-offers/get", adminAuth(adminRoleViewMarketplace(admin.AdminGetOffer(s))))
	mux.Handle("POST /admin/marketplace/provider-offers/approve", adminAuth(adminRoleManageMarketplace(admin.AdminApproveOffer(s))))
	mux.Handle("POST /admin/marketplace/provider-offers/reject", adminAuth(adminRoleManageMarketplace(admin.AdminRejectOffer(s))))
	mux.Handle("POST /admin/marketplace/provider-offers/suspend", adminAuth(adminRoleManageMarketplace(admin.AdminSuspendOffer(s))))
	mux.Handle("POST /admin/marketplace/provider-offers/reinstate", adminAuth(adminRoleManageMarketplace(admin.AdminReinstateOffer(s))))

	// Marketplace subscription management routes
	mux.Handle("POST /admin/marketplace/consumer-subscriptions/list", adminAuth(adminRoleViewMarketplace(admin.AdminListSubscriptions(s))))
	mux.Handle("POST /admin/marketplace/consumer-subscriptions/get", adminAuth(adminRoleViewMarketplace(admin.AdminGetSubscription(s))))
	mux.Handle("POST /admin/marketplace/consumer-subscriptions/approve", adminAuth(adminRoleManageMarketplace(admin.AdminApproveSubscription(s))))
	mux.Handle("POST /admin/marketplace/consumer-subscriptions/reject", adminAuth(adminRoleManageMarketplace(admin.AdminRejectSubscription(s))))
	mux.Handle("POST /admin/marketplace/consumer-subscriptions/mark-contract-signed", adminAuth(adminRoleManageMarketplace(admin.AdminMarkContractSigned(s))))
	mux.Handle("POST /admin/marketplace/consumer-subscriptions/waive-contract", adminAuth(adminRoleManageMarketplace(admin.AdminWaiveContract(s))))
	mux.Handle("POST /admin/marketplace/consumer-subscriptions/record-payment", adminAuth(adminRoleManageMarketplace(admin.AdminRecordPayment(s))))
	mux.Handle("POST /admin/marketplace/consumer-subscriptions/waive-payment", adminAuth(adminRoleManageMarketplace(admin.AdminWaivePayment(s))))
	mux.Handle("POST /admin/marketplace/consumer-subscriptions/cancel", adminAuth(adminRoleManageMarketplace(admin.AdminCancelSubscription(s))))

	// Marketplace billing routes
	mux.Handle("POST /admin/marketplace/billing/list", adminAuth(adminRoleViewMarketplace(admin.AdminListBilling(s))))
}
