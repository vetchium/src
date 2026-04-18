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
	orgRoleViewSubscription := middleware.OrgRole(s.Regional, orgspec.OrgRoleViewSubscription, orgspec.OrgRoleManageSubscription)
	orgRoleManageSubscription := middleware.OrgRole(s.Regional, orgspec.OrgRoleManageSubscription)
	orgRoleViewListings := middleware.OrgRole(s.Regional, orgspec.OrgRoleViewListings, orgspec.OrgRoleManageListings)
	orgRoleManageListings := middleware.OrgRole(s.Regional, orgspec.OrgRoleManageListings)
	orgRoleSuperadmin := middleware.OrgRole(s.Regional, orgspec.OrgRoleSuperadmin)
	orgRoleViewSubscriptions := middleware.OrgRole(s.Regional, orgspec.OrgRoleViewSubscriptions, orgspec.OrgRoleManageSubscriptions)
	orgRoleManageSubscriptions := middleware.OrgRole(s.Regional, orgspec.OrgRoleManageSubscriptions)

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

	// Org subscription / tier routes
	mux.Handle("POST /org/org-subscriptions/list-tiers", orgAuth(org.ListOrgTiers(s)))
	mux.Handle("POST /org/org-subscriptions/get", orgAuth(orgRoleViewSubscription(org.GetMyOrgSubscription(s))))
	mux.Handle("POST /org/org-subscriptions/self-upgrade", orgAuth(orgRoleManageSubscription(org.SelfUpgradeOrgSubscription(s))))

	// Marketplace capability routes (auth-only)
	mux.Handle("POST /org/marketplace/list-capabilities", orgAuth(org.ListMarketplaceCapabilities(s)))

	// Marketplace listing routes
	mux.Handle("POST /org/marketplace/listing/create", orgAuth(orgRoleManageListings(org.CreateMarketplaceListing(s))))
	mux.Handle("POST /org/marketplace/listing/update", orgAuth(orgRoleManageListings(org.UpdateMarketplaceListing(s))))
	mux.Handle("POST /org/marketplace/listing/publish", orgAuth(orgRoleManageListings(org.PublishMarketplaceListing(s))))
	mux.Handle("POST /org/marketplace/listing/approve", orgAuth(orgRoleSuperadmin(org.ApproveListing(s))))
	mux.Handle("POST /org/marketplace/listing/reject", orgAuth(orgRoleSuperadmin(org.RejectListing(s))))
	mux.Handle("POST /org/marketplace/listing/archive", orgAuth(orgRoleManageListings(org.ArchiveMarketplaceListing(s))))
	mux.Handle("POST /org/marketplace/listing/reopen", orgAuth(orgRoleManageListings(org.ReopenMarketplaceListing(s))))
	mux.Handle("POST /org/marketplace/listing/list", orgAuth(orgRoleViewListings(org.ListMyListings(s))))
	mux.Handle("POST /org/marketplace/listing/get", orgAuth(org.GetMarketplaceListing(s)))

	// Marketplace discovery
	mux.Handle("POST /org/marketplace/discover", orgAuth(org.DiscoverListings(s)))

	// Marketplace subscription routes
	mux.Handle("POST /org/marketplace/subscription/subscribe", orgAuth(orgRoleManageSubscriptions(org.Subscribe(s))))
	mux.Handle("POST /org/marketplace/subscription/cancel", orgAuth(orgRoleManageSubscriptions(org.CancelSubscription(s))))
	mux.Handle("POST /org/marketplace/subscription/list", orgAuth(orgRoleViewSubscriptions(org.ListMySubscriptions(s))))
	mux.Handle("POST /org/marketplace/subscription/get", orgAuth(orgRoleViewSubscriptions(org.GetSubscription(s))))

	// Marketplace clients (provider view)
	mux.Handle("POST /org/marketplace/clients/list", orgAuth(orgRoleViewListings(org.ListMyClients(s))))

}
