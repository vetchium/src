package routes

import (
	"net/http"

	orgsaccount "backend/handlers/orgs/account"
	orgsauth "backend/handlers/orgs/auth"
	"backend/handlers/portal"
	"backend/handlers/regions"
	"backend/internal/apiserver"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"
)

func RegisterOrgsRoutes(mux *http.ServeMux, s *orgsruntime.Server) {
	mux.HandleFunc("GET /healthz", apiserver.HealthCheck)
	mux.HandleFunc(
		"GET /api/orgs/ping",
		portal.Ping(s.Runtime, s.Queries, "orgs", s.TenantID),
	)
	mux.HandleFunc(
		"POST /api/orgs/list-signup-regions",
		regions.OrgHandler(s.Runtime, s.Regions),
	)

	orgAuth := middleware.OrgAuth(s)
	recentAuth := middleware.RequireRecentOrgAuthentication(
		s, middleware.RecentAuthenticationWindow,
	)
	mux.HandleFunc("POST /api/orgs/request-signup", orgsauth.RequestSignup(s))
	mux.HandleFunc(
		"POST /api/orgs/get-signup-details", orgsauth.GetSignupDetails(s),
	)
	mux.HandleFunc(
		"POST /api/orgs/complete-signup", orgsauth.CompleteSignup(s),
	)
	mux.HandleFunc("POST /api/orgs/login", orgsauth.Login(s))
	mux.HandleFunc("POST /api/orgs/login/tfa", orgsauth.VerifyTFA(s))
	mux.HandleFunc(
		"POST /api/orgs/login/recovery-code", orgsauth.VerifyRecoveryCode(s),
	)
	mux.HandleFunc("POST /api/orgs/logout", orgsauth.Logout(s))
	mux.Handle(
		"POST /api/orgs/reauthenticate", orgAuth(orgsauth.Reauthenticate(s)),
	)
	mux.HandleFunc(
		"POST /api/orgs/request-password-reset",
		orgsauth.RequestPasswordReset(s),
	)
	mux.HandleFunc(
		"POST /api/orgs/complete-password-reset",
		orgsauth.CompletePasswordReset(s),
	)
	mux.Handle(
		"POST /api/orgs/change-password",
		orgAuth(recentAuth(orgsauth.ChangePassword(s))),
	)
	mux.Handle(
		"POST /api/orgs/start-totp-enrollment",
		orgAuth(recentAuth(orgsauth.StartTOTPEnrollment(s))),
	)
	mux.Handle(
		"POST /api/orgs/confirm-totp-enrollment",
		orgAuth(orgsauth.ConfirmTOTPEnrollment(s)),
	)
	mux.Handle(
		"POST /api/orgs/disable-totp",
		orgAuth(recentAuth(orgsauth.DisableTOTP(s))),
	)
	mux.Handle(
		"POST /api/orgs/regenerate-totp-recovery-codes",
		orgAuth(recentAuth(orgsauth.RegenerateTOTPRecoveryCodes(s))),
	)
	mux.Handle("GET /api/orgs/my-info", orgAuth(orgsaccount.MyInfo(s)))
	mux.Handle(
		"POST /api/orgs/check-domain", orgAuth(orgsaccount.CheckDomain(s)),
	)
}
