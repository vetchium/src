package routes

import (
	"net/http"

	"vetchium-api-server.gomodule/handlers/employer"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
	employerspec "vetchium-api-server.typespec/employer"
)

func RegisterEmployerRoutes(mux *http.ServeMux, s *server.RegionalServer) {
	// Unauthenticated routes
	mux.HandleFunc("POST /employer/init-signup", employer.InitSignup(s))
	mux.HandleFunc("POST /employer/get-signup-details", employer.GetSignupDetails(s))
	mux.HandleFunc("POST /employer/complete-signup", employer.CompleteSignup(s))
	mux.HandleFunc("POST /employer/login", employer.Login(s))
	mux.HandleFunc("POST /employer/tfa", employer.TFA(s))
	mux.HandleFunc("POST /employer/complete-setup", employer.CompleteSetup(s))
	mux.HandleFunc("POST /employer/request-password-reset", employer.RequestPasswordReset(s))
	mux.HandleFunc("POST /employer/complete-password-reset", employer.CompletePasswordReset(s))

	// Create middleware instances
	orgAuth := middleware.OrgAuth(s.Regional, s.CurrentRegion, s.InternalEndpoints)
	employerRoleViewUsers := middleware.EmployerRole(s.Regional, employerspec.OrgRoleViewUsers, employerspec.OrgRoleManageUsers)
	employerRoleManageUsers := middleware.EmployerRole(s.Regional, employerspec.OrgRoleManageUsers)
	employerRoleViewDomains := middleware.EmployerRole(s.Regional, employerspec.OrgRoleViewDomains, employerspec.OrgRoleManageDomains)
	employerRoleManageDomains := middleware.EmployerRole(s.Regional, employerspec.OrgRoleManageDomains)
	employerRoleViewCostCenters := middleware.EmployerRole(s.Regional, employerspec.OrgRoleViewCostCenters, employerspec.OrgRoleManageCostCenters)
	employerRoleManageCostCenters := middleware.EmployerRole(s.Regional, employerspec.OrgRoleManageCostCenters)
	employerRoleViewAuditLogs := middleware.EmployerRole(s.Regional, employerspec.OrgRoleViewAuditLogs)
	employerRoleViewSubOrgs := middleware.EmployerRole(s.Regional, employerspec.OrgRoleViewSubOrgs, employerspec.OrgRoleManageSubOrgs)
	employerRoleManageSubOrgs := middleware.EmployerRole(s.Regional, employerspec.OrgRoleManageSubOrgs)

	// Domain write routes (manage_domains required; superadmin bypasses via middleware)
	mux.Handle("POST /employer/claim-domain", orgAuth(employerRoleManageDomains(employer.ClaimDomain(s))))
	mux.Handle("POST /employer/verify-domain", orgAuth(employerRoleManageDomains(employer.VerifyDomain(s))))
	// Domain read routes (view_domains or manage_domains)
	mux.Handle("POST /employer/get-domain-status", orgAuth(employerRoleViewDomains(employer.GetDomainStatus(s))))
	mux.Handle("POST /employer/list-domains", orgAuth(employerRoleViewDomains(employer.ListDomains(s))))
	mux.Handle("POST /employer/assign-role", orgAuth(employerRoleManageUsers(employer.AssignRole(s))))
	mux.Handle("POST /employer/remove-role", orgAuth(employerRoleManageUsers(employer.RemoveRole(s))))

	// User management write routes (manage_users required)
	mux.Handle("POST /employer/invite-user", orgAuth(employerRoleManageUsers(employer.InviteUser(s))))
	mux.Handle("POST /employer/disable-user", orgAuth(employerRoleManageUsers(employer.DisableUser(s))))
	mux.Handle("POST /employer/enable-user", orgAuth(employerRoleManageUsers(employer.EnableUser(s))))

	// Auth-only routes (any authenticated employer user)
	mux.Handle("POST /employer/logout", orgAuth(employer.Logout(s)))
	mux.Handle("POST /employer/change-password", orgAuth(employer.ChangePassword(s)))
	mux.Handle("POST /employer/set-language", orgAuth(employer.SetLanguage(s)))
	mux.Handle("GET /employer/myinfo", orgAuth(employer.MyInfo(s)))
	mux.Handle("POST /employer/filter-users", orgAuth(employerRoleViewUsers(employer.FilterUsers(s))))

	// Tag read routes (auth-only, no role restriction)
	mux.Handle("POST /employer/get-tag", orgAuth(employer.GetTag(s)))
	mux.Handle("POST /employer/filter-tags", orgAuth(employer.FilterTags(s)))

	// Cost center routes
	mux.Handle("POST /employer/add-cost-center", orgAuth(employerRoleManageCostCenters(employer.AddCostCenter(s))))
	mux.Handle("POST /employer/update-cost-center", orgAuth(employerRoleManageCostCenters(employer.UpdateCostCenter(s))))
	mux.Handle("POST /employer/list-cost-centers", orgAuth(employerRoleViewCostCenters(employer.ListCostCenters(s))))

	// SubOrg routes
	mux.Handle("POST /employer/create-suborg", orgAuth(employerRoleManageSubOrgs(employer.CreateSubOrg(s))))
	mux.Handle("POST /employer/list-suborgs", orgAuth(employerRoleViewSubOrgs(employer.ListSubOrgs(s))))
	mux.Handle("POST /employer/rename-suborg", orgAuth(employerRoleManageSubOrgs(employer.RenameSubOrg(s))))
	mux.Handle("POST /employer/disable-suborg", orgAuth(employerRoleManageSubOrgs(employer.DisableSubOrg(s))))
	mux.Handle("POST /employer/enable-suborg", orgAuth(employerRoleManageSubOrgs(employer.EnableSubOrg(s))))
	mux.Handle("POST /employer/add-suborg-member", orgAuth(employerRoleManageSubOrgs(employer.AddSubOrgMember(s))))
	mux.Handle("POST /employer/remove-suborg-member", orgAuth(employerRoleManageSubOrgs(employer.RemoveSubOrgMember(s))))
	mux.Handle("POST /employer/list-suborg-members", orgAuth(employerRoleViewSubOrgs(employer.ListSubOrgMembers(s))))

	// Audit log routes
	mux.Handle("POST /employer/filter-audit-logs", orgAuth(employerRoleViewAuditLogs(employer.FilterAuditLogs(s))))
}
