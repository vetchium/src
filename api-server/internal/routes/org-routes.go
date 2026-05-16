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
	orgAuth := middleware.OrgAuth(s.AllRegionalDBs)
	orgRoleViewUsers := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewUsers, orgspec.OrgRoleManageUsers)
	orgRoleManageUsers := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageUsers)
	orgRoleViewDomains := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewDomains, orgspec.OrgRoleManageDomains)
	orgRoleManageDomains := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageDomains)
	orgRoleViewCostCenters := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewCostCenters, orgspec.OrgRoleManageCostCenters)
	orgRoleManageCostCenters := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageCostCenters)
	orgRoleViewAuditLogs := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewAuditLogs)
	orgRoleViewSubOrgs := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewSubOrgs, orgspec.OrgRoleManageSubOrgs)
	orgRoleManageSubOrgs := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageSubOrgs)
	orgRoleViewPlan := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewPlan, orgspec.OrgRoleManagePlan)
	orgRoleManagePlan := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManagePlan)
	orgRoleViewListings := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewListings, orgspec.OrgRoleManageListings)
	orgRoleManageListings := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageListings)
	orgRoleSuperadmin := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleSuperadmin)
	orgRoleViewSubscriptions := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewSubscriptions, orgspec.OrgRoleManageSubscriptions)
	orgRoleManageSubscriptions := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageSubscriptions)
	orgRoleViewAddresses := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewAddresses, orgspec.OrgRoleManageAddresses)
	orgRoleManageAddresses := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageAddresses)
	orgRoleViewOpenings := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleViewOpenings, orgspec.OrgRoleManageOpenings)
	orgRoleManageOpenings := middleware.OrgRole(s.AllRegionalDBs, orgspec.OrgRoleManageOpenings)

	// Domain write routes (manage_domains required; superadmin bypasses via middleware)
	mux.Handle("POST /org/claim-domain", orgAuth(orgRoleManageDomains(org.ClaimDomain(s))))
	mux.Handle("POST /org/verify-domain", orgAuth(orgRoleManageDomains(org.VerifyDomain(s))))
	mux.Handle("POST /org/set-primary-domain", orgAuth(orgRoleManageDomains(org.SetPrimaryDomain(s))))
	mux.Handle("POST /org/delete-domain", orgAuth(orgRoleManageDomains(org.DeleteDomain(s))))
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
	mux.Handle("POST /org/list-users", orgAuth(orgRoleViewUsers(org.FilterUsers(s))))

	// Tag read routes (auth-only, no role restriction)
	mux.Handle("POST /org/get-tag", orgAuth(org.GetTag(s)))
	mux.Handle("POST /org/list-tags", orgAuth(org.FilterTags(s)))

	// Cost center routes
	mux.Handle("POST /org/create-cost-center", orgAuth(orgRoleManageCostCenters(org.AddCostCenter(s))))
	mux.Handle("POST /org/update-cost-center", orgAuth(orgRoleManageCostCenters(org.UpdateCostCenter(s))))
	mux.Handle("POST /org/list-cost-centers", orgAuth(orgRoleViewCostCenters(org.ListCostCenters(s))))

	// Company Address routes
	mux.Handle("POST /org/create-address", orgAuth(orgRoleManageAddresses(org.CreateAddress(s))))
	mux.Handle("POST /org/update-address", orgAuth(orgRoleManageAddresses(org.UpdateAddress(s))))
	mux.Handle("POST /org/disable-address", orgAuth(orgRoleManageAddresses(org.DisableAddress(s))))
	mux.Handle("POST /org/enable-address", orgAuth(orgRoleManageAddresses(org.EnableAddress(s))))
	mux.Handle("POST /org/get-address", orgAuth(orgRoleViewAddresses(org.GetAddress(s))))
	mux.Handle("POST /org/list-addresses", orgAuth(orgRoleViewAddresses(org.ListAddresses(s))))

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
	mux.Handle("POST /org/list-audit-logs", orgAuth(orgRoleViewAuditLogs(org.FilterAuditLogs(s))))

	// Org plan routes
	mux.Handle("POST /org/list-plans", orgAuth(org.ListPlans(s)))
	mux.Handle("POST /org/get-plan", orgAuth(orgRoleViewPlan(org.GetMyOrgPlan(s))))
	mux.Handle("POST /org/upgrade-plan", orgAuth(orgRoleManagePlan(org.UpgradeOrgPlan(s))))

	// Marketplace capability routes (auth-only)
	mux.Handle("POST /org/marketplace/list-capabilities", orgAuth(org.ListMarketplaceCapabilities(s)))

	// Marketplace listing routes
	mux.Handle("POST /org/marketplace/create-listing", orgAuth(orgRoleManageListings(org.CreateMarketplaceListing(s))))
	mux.Handle("POST /org/marketplace/update-listing", orgAuth(orgRoleManageListings(org.UpdateMarketplaceListing(s))))
	mux.Handle("POST /org/marketplace/publish-listing", orgAuth(orgRoleManageListings(org.PublishMarketplaceListing(s))))
	mux.Handle("POST /org/marketplace/approve-listing", orgAuth(orgRoleSuperadmin(org.ApproveListing(s))))
	mux.Handle("POST /org/marketplace/reject-listing", orgAuth(orgRoleSuperadmin(org.RejectListing(s))))
	mux.Handle("POST /org/marketplace/archive-listing", orgAuth(orgRoleManageListings(org.ArchiveMarketplaceListing(s))))
	mux.Handle("POST /org/marketplace/reopen-listing", orgAuth(orgRoleManageListings(org.ReopenMarketplaceListing(s))))
	mux.Handle("POST /org/marketplace/add-listing-capability", orgAuth(orgRoleManageListings(org.AddListingCapability(s))))
	mux.Handle("POST /org/marketplace/remove-listing-capability", orgAuth(orgRoleManageListings(org.RemoveListingCapability(s))))
	mux.Handle("POST /org/marketplace/list-listings", orgAuth(orgRoleViewListings(org.ListMyListings(s))))
	mux.Handle("POST /org/marketplace/get-listing", orgAuth(org.GetMarketplaceListing(s)))

	// Marketplace discovery
	mux.Handle("POST /org/marketplace/discover", orgAuth(org.DiscoverListings(s)))

	// Marketplace subscription routes
	mux.Handle("POST /org/marketplace/create-subscription", orgAuth(orgRoleManageSubscriptions(org.Subscribe(s))))
	mux.Handle("POST /org/marketplace/cancel-subscription", orgAuth(orgRoleManageSubscriptions(org.CancelSubscription(s))))
	mux.Handle("POST /org/marketplace/list-subscriptions", orgAuth(orgRoleViewSubscriptions(org.ListMySubscriptions(s))))
	mux.Handle("POST /org/marketplace/get-subscription", orgAuth(orgRoleViewSubscriptions(org.GetSubscription(s))))

	// Marketplace clients (provider view)
	mux.Handle("POST /org/marketplace/list-clients", orgAuth(orgRoleViewListings(org.ListMyClients(s))))

	// Job opening routes
	mux.Handle("POST /org/create-opening", orgAuth(orgRoleManageOpenings(org.CreateOpening(s))))
	mux.Handle("POST /org/list-openings", orgAuth(orgRoleViewOpenings(org.ListOpenings(s))))
	mux.Handle("POST /org/get-opening", orgAuth(orgRoleViewOpenings(org.GetOpening(s))))
	mux.Handle("POST /org/update-opening", orgAuth(orgRoleManageOpenings(org.UpdateOpening(s))))
	mux.Handle("POST /org/discard-opening", orgAuth(orgRoleManageOpenings(org.DiscardOpening(s))))
	mux.Handle("POST /org/duplicate-opening", orgAuth(orgRoleManageOpenings(org.DuplicateOpening(s))))
	mux.Handle("POST /org/submit-opening", orgAuth(orgRoleManageOpenings(org.SubmitOpening(s))))
	mux.Handle("POST /org/approve-opening", orgAuth(orgRoleManageOpenings(org.ApproveOpening(s))))
	mux.Handle("POST /org/reject-opening", orgAuth(orgRoleManageOpenings(org.RejectOpening(s))))
	mux.Handle("POST /org/pause-opening", orgAuth(orgRoleManageOpenings(org.PauseOpening(s))))
	mux.Handle("POST /org/reopen-opening", orgAuth(orgRoleManageOpenings(org.ReopenOpening(s))))
	mux.Handle("POST /org/close-opening", orgAuth(orgRoleManageOpenings(org.CloseOpening(s))))
	mux.Handle("POST /org/archive-opening", orgAuth(orgRoleManageOpenings(org.ArchiveOpening(s))))

}
