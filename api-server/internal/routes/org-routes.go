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

	// Authenticated routes (require Authorization header)
	orgAuth := middleware.OrgAuth(s.Global, s.GetRegionalDB)
	mux.Handle("POST /org/claim-domain", orgAuth(org.ClaimDomain(s)))
	mux.Handle("POST /org/verify-domain", orgAuth(org.VerifyDomain(s)))
	mux.Handle("POST /org/get-domain-status", orgAuth(org.GetDomainStatus(s)))
	mux.Handle("POST /employer/logout", orgAuth(org.Logout(s)))
	mux.Handle("POST /employer/invite-user", orgAuth(org.InviteUser(s)))
	mux.Handle("POST /employer/disable-user", orgAuth(org.DisableUser(s)))
	mux.Handle("POST /employer/enable-user", orgAuth(org.EnableUser(s)))
	mux.Handle("POST /employer/change-password", orgAuth(org.ChangePassword(s)))

	// RBAC routes
	mux.Handle("POST /employer/assign-role", orgAuth(org.AssignRole(s)))
	mux.Handle("POST /employer/remove-role", orgAuth(org.RemoveRole(s)))
}
