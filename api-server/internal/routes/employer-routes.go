package routes

import (
	"net/http"

	"vetchium-api-server.gomodule/handlers/employer"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
)

func RegisterEmployerRoutes(mux *http.ServeMux, s *server.Server) {
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
	employerRoleInvite := middleware.EmployerRole(s.Regional, "employer:invite_users")
	employerRoleManage := middleware.EmployerRole(s.Regional, "employer:manage_users")
	employerRoleSuperadmin := middleware.EmployerRole(s.Regional, "employer:superadmin")

	// Superadmin-only routes (employer:superadmin required)
	mux.Handle("POST /employer/claim-domain", orgAuth(employerRoleSuperadmin(employer.ClaimDomain(s))))
	mux.Handle("POST /employer/verify-domain", orgAuth(employerRoleSuperadmin(employer.VerifyDomain(s))))
	mux.Handle("POST /employer/get-domain-status", orgAuth(employerRoleSuperadmin(employer.GetDomainStatus(s))))
	mux.Handle("POST /employer/list-domains", orgAuth(employerRoleSuperadmin(employer.ListDomains(s))))
	mux.Handle("POST /employer/assign-role", orgAuth(employerRoleManage(employer.AssignRole(s))))
	mux.Handle("POST /employer/remove-role", orgAuth(employerRoleManage(employer.RemoveRole(s))))

	// Role-protected routes
	mux.Handle("POST /employer/invite-user", orgAuth(employerRoleInvite(employer.InviteUser(s))))
	mux.Handle("POST /employer/disable-user", orgAuth(employerRoleManage(employer.DisableUser(s))))
	mux.Handle("POST /employer/enable-user", orgAuth(employerRoleManage(employer.EnableUser(s))))

	// Auth-only routes (any authenticated employer user)
	mux.Handle("POST /employer/logout", orgAuth(employer.Logout(s)))
	mux.Handle("POST /employer/change-password", orgAuth(employer.ChangePassword(s)))
	mux.Handle("POST /employer/set-language", orgAuth(employer.SetLanguage(s)))
	mux.Handle("GET /employer/myinfo", orgAuth(employer.MyInfo(s)))
	mux.Handle("POST /employer/filter-users", orgAuth(employer.FilterUsers(s)))
}
