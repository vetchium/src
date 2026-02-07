package routes

import (
	"net/http"

	"vetchium-api-server.gomodule/handlers/org"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
)

func RegisterOrgRoutes(mux *http.ServeMux, s *server.Server) {
	// Unauthenticated routes
	mux.HandleFunc("POST /org/init-signup", org.InitSignup(s))
	mux.HandleFunc("POST /org/get-signup-details", org.GetSignupDetails(s))
	mux.HandleFunc("POST /org/complete-signup", org.CompleteSignup(s))
	mux.HandleFunc("POST /employer/login", org.Login(s))
	mux.HandleFunc("POST /employer/tfa", org.TFA(s))
	mux.HandleFunc("POST /employer/complete-setup", org.CompleteSetup(s))
	mux.HandleFunc("POST /employer/request-password-reset", org.RequestPasswordReset(s))
	mux.HandleFunc("POST /employer/complete-password-reset", org.CompletePasswordReset(s))

	// Create middleware instances
	orgAuth := middleware.OrgAuth(s.GetRegionalDB)
	employerRoleInvite := middleware.EmployerRole(s.GetRegionalDB, "employer:invite_users")
	employerRoleManage := middleware.EmployerRole(s.GetRegionalDB, "employer:manage_users")
	employerAdminOnly := middleware.EmployerAdminOnly()

	// Admin-only routes (IsAdmin flag required, not delegatable)
	mux.Handle("POST /org/claim-domain", orgAuth(employerAdminOnly(org.ClaimDomain(s))))
	mux.Handle("POST /org/verify-domain", orgAuth(employerAdminOnly(org.VerifyDomain(s))))
	mux.Handle("POST /org/get-domain-status", orgAuth(employerAdminOnly(org.GetDomainStatus(s))))
	mux.Handle("POST /employer/assign-role", orgAuth(employerRoleManage(org.AssignRole(s))))
	mux.Handle("POST /employer/remove-role", orgAuth(employerRoleManage(org.RemoveRole(s))))

	// Role-protected routes (IsAdmin OR role)
	mux.Handle("POST /employer/invite-user", orgAuth(employerRoleInvite(org.InviteUser(s))))
	mux.Handle("POST /employer/disable-user", orgAuth(employerRoleManage(org.DisableUser(s))))
	mux.Handle("POST /employer/enable-user", orgAuth(employerRoleManage(org.EnableUser(s))))

	// Auth-only routes (any authenticated employer user)
	mux.Handle("POST /employer/logout", orgAuth(org.Logout(s)))
	mux.Handle("POST /employer/change-password", orgAuth(org.ChangePassword(s)))
	mux.Handle("POST /employer/set-language", orgAuth(org.SetLanguage(s)))
	mux.Handle("GET /employer/myinfo", orgAuth(org.MyInfo(s)))
	mux.Handle("POST /employer/filter-users", orgAuth(org.FilterUsers(s)))
}
