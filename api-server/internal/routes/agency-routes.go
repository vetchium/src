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

	// Authenticated routes (require Authorization header)
	agencyAuth := middleware.AgencyAuth(s.Global, s.GetRegionalDB)
	mux.Handle("POST /agency/logout", agencyAuth(agency.Logout(s)))
	mux.Handle("POST /agency/change-password", agencyAuth(agency.ChangePassword(s)))
	mux.Handle("POST /agency/invite-user", agencyAuth(agency.InviteUser(s)))
	mux.Handle("POST /agency/disable-user", agencyAuth(agency.DisableUser(s)))
	mux.Handle("POST /agency/enable-user", agencyAuth(agency.EnableUser(s)))
}
