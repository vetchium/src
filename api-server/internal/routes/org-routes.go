package routes

import (
	"net/http"

	"vetchium-api-server.gomodule/handlers/org"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	orgspec "vetchium-api-server.typespec/org"
)

func RegisterOrgRoutes(mux *http.ServeMux, s *server.RegionalServer) {
	// Unauthenticated routes
	mux.HandleFunc("POST /org/init-signup", org.InitSignup(s))
	mux.HandleFunc("POST /org/get-signup-details", org.GetSignupDetails(s))
	mux.HandleFunc("POST /org/complete-signup", org.CompleteSignup(s))
	mux.HandleFunc("POST /org/login", org.Login(s))
	mux.HandleFunc("POST /org/tfa", org.TFA(s))
	mux.HandleFunc("POST /org/complete-setup", org.CompleteSetup(s))
	mux.HandleFunc("POST /org/request-password-reset", org.RequestPasswordReset(s))
	mux.HandleFunc("POST /org/complete-password-reset", org.CompletePasswordReset(s))

	// Create middleware instances
	orgAuth := middleware.OrgAuth(s.Regional, s.CurrentRegion, s.InternalEndpoints)
	orgRoleViewUsers := middleware.OrgRole(s.Regional, orgspec.OrgRoleViewUsers, orgspec.OrgRoleManageUsers)
	orgRoleManageUsers := middleware.OrgRole(s.Regional, orgspec.OrgRoleManageUsers)
	orgRoleViewDomains := middleware.OrgRole(s.Regional, orgspec.OrgRoleViewDomains, orgspec.OrgRoleManageDomains)
	orgRoleManageDomains := middleware.OrgRole(s.Regional, orgspec.OrgRoleManageDomains)
	orgRoleViewCostCenters := middleware.OrgRole(s.Regional, orgspec.OrgRoleViewCostCenters, orgspec.OrgRoleManageCostCenters)
	orgRoleManageCostCenters := middleware.OrgRole(s.Regional, orgspec.OrgRoleManageCostCenters)
	orgRoleViewAuditLogs := middleware.OrgRole(s.Regional, orgspec.OrgRoleViewAuditLogs)
	orgRoleViewSubOrgs := middleware.OrgRole(s.Regional, orgspec.OrgRoleViewSubOrgs, orgspec.OrgRoleManageSubOrgs)
	orgRoleManageSubOrgs := middleware.OrgRole(s.Regional, orgspec.OrgRoleManageSubOrgs)
	orgRoleViewMarketplace := middleware.OrgRole(s.Regional, orgspec.OrgRoleViewMarketplace, orgspec.OrgRoleManageMarketplace)
	orgRoleManageMarketplace := middleware.OrgRole(s.Regional, orgspec.OrgRoleManageMarketplace)

	// Domain write routes (manage_domains required; superadmin bypasses via middleware)
	mux.Handle("POST /org/claim-domain", orgAuth(orgRoleManageDomains(org.ClaimDomain(s))))
	mux.Handle("POST /org/verify-domain", orgAuth(orgRoleManageDomains(org.VerifyDomain(s))))
	// Domain read routes (view_domains or manage_domains)
	mux.Handle("POST /org/get-domain-status", orgAuth(orgRoleViewDomains(org.GetDomainStatus(s))))
	mux.Handle("POST /org/list-domains", orgAuth(orgRoleViewDomains(org.ListDomains(s))))
	mux.Handle("POST /org/assign-role", orgAuth(orgRoleManageUsers(org.AssignRole(s))))
	mux.Handle("POST /org/remove-role", orgAuth(orgRoleManageUsers(org.RemoveRole(s))))

	// User management write routes (manage_users required)
	mux.Handle("POST /org/invite-user", orgAuth(orgRoleManageUsers(org.InviteUser(s))))
	mux.Handle("POST /org/disable-user", orgAuth(orgRoleManageUsers(org.DisableUser(s))))
	mux.Handle("POST /org/enable-user", orgAuth(orgRoleManageUsers(org.EnableUser(s))))

	// Auth-only routes (any authenticated org user)
	mux.Handle("POST /org/logout", orgAuth(org.Logout(s)))
	mux.Handle("POST /org/change-password", orgAuth(org.ChangePassword(s)))
	mux.Handle("POST /org/set-language", orgAuth(org.SetLanguage(s)))
	mux.Handle("GET /org/myinfo", orgAuth(org.MyInfo(s)))
	mux.Handle("POST /org/filter-users", orgAuth(orgRoleViewUsers(org.FilterUsers(s))))

	// Tag read routes (auth-only, no role restriction)
	mux.Handle("POST /org/get-tag", orgAuth(org.GetTag(s)))
	mux.Handle("POST /org/filter-tags", orgAuth(org.FilterTags(s)))

	// Cost center routes
	mux.Handle("POST /org/add-cost-center", orgAuth(orgRoleManageCostCenters(org.AddCostCenter(s))))
	mux.Handle("POST /org/update-cost-center", orgAuth(orgRoleManageCostCenters(org.UpdateCostCenter(s))))
	mux.Handle("POST /org/list-cost-centers", orgAuth(orgRoleViewCostCenters(org.ListCostCenters(s))))

	// SubOrg routes
	mux.Handle("POST /org/create-suborg", orgAuth(orgRoleManageSubOrgs(org.CreateSubOrg(s))))
	mux.Handle("POST /org/list-suborgs", orgAuth(orgRoleViewSubOrgs(org.ListSubOrgs(s))))
	mux.Handle("POST /org/rename-suborg", orgAuth(orgRoleManageSubOrgs(org.RenameSubOrg(s))))
	mux.Handle("POST /org/disable-suborg", orgAuth(orgRoleManageSubOrgs(org.DisableSubOrg(s))))
	mux.Handle("POST /org/enable-suborg", orgAuth(orgRoleManageSubOrgs(org.EnableSubOrg(s))))
	mux.Handle("POST /org/add-suborg-member", orgAuth(orgRoleManageSubOrgs(org.AddSubOrgMember(s))))
	mux.Handle("POST /org/remove-suborg-member", orgAuth(orgRoleManageSubOrgs(org.RemoveSubOrgMember(s))))
	mux.Handle("POST /org/list-suborg-members", orgAuth(orgRoleViewSubOrgs(org.ListSubOrgMembers(s))))

	// Audit log routes
	mux.Handle("POST /org/filter-audit-logs", orgAuth(orgRoleViewAuditLogs(org.FilterAuditLogs(s))))

	// Marketplace capability catalog routes (view or manage marketplace)
	mux.Handle("POST /org/marketplace/capabilities/list", orgAuth(orgRoleViewMarketplace(org.ListMarketplaceCapabilities(s))))
	mux.Handle("POST /org/marketplace/capabilities/get", orgAuth(orgRoleViewMarketplace(org.GetMarketplaceCapability(s))))

	// Marketplace provider enrollment routes (manage_marketplace required)
	mux.Handle("POST /org/marketplace/provider-enrollments/list", orgAuth(orgRoleViewMarketplace(org.ListProviderEnrollments(s))))
	mux.Handle("POST /org/marketplace/provider-enrollments/get", orgAuth(orgRoleViewMarketplace(org.GetProviderEnrollment(s))))
	mux.Handle("POST /org/marketplace/provider-enrollments/apply", orgAuth(orgRoleManageMarketplace(org.ApplyProviderEnrollment(s))))
	mux.Handle("POST /org/marketplace/provider-enrollments/reapply", orgAuth(orgRoleManageMarketplace(org.ReapplyProviderEnrollment(s))))

	// Marketplace provider offer routes (manage_marketplace for write, view for read)
	mux.Handle("POST /org/marketplace/provider-offers/get", orgAuth(orgRoleViewMarketplace(org.GetProviderOffer(s))))
	mux.Handle("POST /org/marketplace/provider-offers/create", orgAuth(orgRoleManageMarketplace(org.CreateProviderOffer(s))))
	mux.Handle("POST /org/marketplace/provider-offers/update", orgAuth(orgRoleManageMarketplace(org.UpdateProviderOffer(s))))
	mux.Handle("POST /org/marketplace/provider-offers/submit", orgAuth(orgRoleManageMarketplace(org.SubmitProviderOffer(s))))
	mux.Handle("POST /org/marketplace/provider-offers/archive", orgAuth(orgRoleManageMarketplace(org.ArchiveProviderOffer(s))))

	// Marketplace providers browse routes (any authenticated org user — buyer perspective)
	mux.Handle("POST /org/marketplace/providers/list", orgAuth(org.ListMarketplaceProviders(s)))
	mux.Handle("POST /org/marketplace/providers/get-offer", orgAuth(org.GetMarketplaceProviderOffer(s)))

	// Marketplace consumer subscription routes (view or manage marketplace)
	mux.Handle("POST /org/marketplace/consumer-subscriptions/list", orgAuth(orgRoleViewMarketplace(org.ListConsumerSubscriptions(s))))
	mux.Handle("POST /org/marketplace/consumer-subscriptions/get", orgAuth(orgRoleViewMarketplace(org.GetConsumerSubscription(s))))
	mux.Handle("POST /org/marketplace/consumer-subscriptions/request", orgAuth(orgRoleManageMarketplace(org.RequestConsumerSubscription(s))))
	mux.Handle("POST /org/marketplace/consumer-subscriptions/cancel", orgAuth(orgRoleManageMarketplace(org.CancelConsumerSubscription(s))))

	// Marketplace incoming subscription routes (provider perspective — manage_marketplace required)
	mux.Handle("POST /org/marketplace/incoming-subscriptions/list", orgAuth(orgRoleViewMarketplace(org.ListIncomingSubscriptions(s))))
	mux.Handle("POST /org/marketplace/incoming-subscriptions/get", orgAuth(orgRoleViewMarketplace(org.GetIncomingSubscription(s))))
	mux.Handle("POST /org/marketplace/incoming-subscriptions/provider-approve", orgAuth(orgRoleManageMarketplace(org.ProviderApproveSubscription(s))))
	mux.Handle("POST /org/marketplace/incoming-subscriptions/provider-reject", orgAuth(orgRoleManageMarketplace(org.ProviderRejectSubscription(s))))
}
