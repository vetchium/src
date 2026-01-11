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
	mux.HandleFunc("POST /org/complete-signup", org.CompleteSignup(s))
	mux.HandleFunc("POST /employer/login", org.Login(s))
	mux.HandleFunc("POST /employer/tfa", org.TFA(s))

	// Authenticated routes (require Authorization header)
	orgAuth := middleware.OrgAuth(s.Global, s.GetRegionalDB)
	mux.Handle("POST /org/claim-domain", orgAuth(http.HandlerFunc(org.ClaimDomain(s))))
	mux.Handle("POST /org/verify-domain", orgAuth(http.HandlerFunc(org.VerifyDomain(s))))
	mux.Handle("POST /org/get-domain-status", orgAuth(http.HandlerFunc(org.GetDomainStatus(s))))
	mux.Handle("POST /employer/logout", orgAuth(http.HandlerFunc(org.Logout(s))))
}
