package routes

import (
	"net/http"

	"vetchium-api-server.gomodule/handlers/agency"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
)

func RegisterAgencyRoutes(mux *http.ServeMux, s *server.Server) {
	// Unauthenticated routes
	mux.HandleFunc("POST /agency/init-signup", agency.InitSignup(s))
	mux.HandleFunc("POST /agency/get-signup-details", agency.GetSignupDetails(s))
	mux.HandleFunc("POST /agency/complete-signup", agency.CompleteSignup(s))
	mux.HandleFunc("POST /agency/login", agency.Login(s))
	mux.HandleFunc("POST /agency/tfa", agency.TFA(s))
	mux.HandleFunc("POST /agency/complete-setup", agency.CompleteSetup(s))
	mux.HandleFunc("POST /agency/request-password-reset", agency.RequestPasswordReset(s))
	mux.HandleFunc("POST /agency/complete-password-reset", agency.CompletePasswordReset(s))

	// Create middleware instances
	agencyAuth := middleware.AgencyAuth(s.Regional, s.CurrentRegion, s.InternalEndpoints)
	agencyRoleViewUsers := middleware.AgencyRole(s.Regional, "agency:view_users", "agency:manage_users")
	agencyRoleManageUsers := middleware.AgencyRole(s.Regional, "agency:manage_users")
	agencyRoleViewDomains := middleware.AgencyRole(s.Regional, "agency:view_domains", "agency:manage_domains")
	agencyRoleManageDomains := middleware.AgencyRole(s.Regional, "agency:manage_domains")

	// Domain write routes (manage_domains required; superadmin bypasses via middleware)
	mux.Handle("POST /agency/claim-domain", agencyAuth(agencyRoleManageDomains(agency.ClaimDomain(s))))
	mux.Handle("POST /agency/verify-domain", agencyAuth(agencyRoleManageDomains(agency.VerifyDomain(s))))
	// Domain read routes (view_domains or manage_domains)
	mux.Handle("POST /agency/get-domain-status", agencyAuth(agencyRoleViewDomains(agency.GetDomainStatus(s))))
	mux.Handle("POST /agency/list-domains", agencyAuth(agencyRoleViewDomains(agency.ListDomains(s))))

	// User management write routes (manage_users required)
	mux.Handle("POST /agency/assign-role", agencyAuth(agencyRoleManageUsers(agency.AssignRole(s))))
	mux.Handle("POST /agency/remove-role", agencyAuth(agencyRoleManageUsers(agency.RemoveRole(s))))

	// User management write routes (manage_users required)
	mux.Handle("POST /agency/invite-user", agencyAuth(agencyRoleManageUsers(agency.InviteUser(s))))
	mux.Handle("POST /agency/disable-user", agencyAuth(agencyRoleManageUsers(agency.DisableUser(s))))
	mux.Handle("POST /agency/enable-user", agencyAuth(agencyRoleManageUsers(agency.EnableUser(s))))

	// Auth-only routes (any authenticated agency user)
	mux.Handle("POST /agency/logout", agencyAuth(agency.Logout(s)))
	mux.Handle("POST /agency/change-password", agencyAuth(agency.ChangePassword(s)))
	mux.Handle("POST /agency/set-language", agencyAuth(agency.SetLanguage(s)))
	mux.Handle("GET /agency/myinfo", agencyAuth(agency.MyInfo(s)))
	mux.Handle("POST /agency/filter-users", agencyAuth(agencyRoleViewUsers(agency.FilterUsers(s))))
}
