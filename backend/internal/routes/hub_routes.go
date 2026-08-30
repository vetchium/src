package routes

import (
	"net/http"

	hubauth "backend/handlers/hub/auth"
	hubusers "backend/handlers/hub/users"
	"backend/handlers/portal"
	"backend/internal/apiserver"
	hubruntime "backend/internal/hub"
	"backend/internal/middleware"
)

func RegisterHubRoutes(mux *http.ServeMux, s *hubruntime.Server) {
	mux.HandleFunc("GET /healthz", apiserver.HealthCheck)
	mux.HandleFunc(
		"GET /api/hub/ping", portal.Ping(s.Runtime, s.Queries, "hub", s.TenantID),
	)

	hubAuth := middleware.HubAuth(s)
	recentAuth := middleware.RequireRecentHubAuthentication(
		s, middleware.RecentAuthenticationWindow,
	)
	mux.HandleFunc("POST /api/hub/request-signup", hubauth.RequestSignup(s))
	mux.HandleFunc("POST /api/hub/complete-signup", hubauth.CompleteSignup(s))
	mux.HandleFunc("POST /api/hub/login", hubauth.Login(s))
	mux.HandleFunc("POST /api/hub/login/tfa", hubauth.VerifyTFA(s))
	mux.HandleFunc(
		"POST /api/hub/login/recovery-code", hubauth.VerifyRecoveryCode(s),
	)
	mux.HandleFunc("POST /api/hub/logout", hubauth.Logout(s))
	mux.Handle(
		"POST /api/hub/reauthenticate",
		hubAuth(hubauth.Reauthenticate(s)),
	)
	mux.HandleFunc(
		"POST /api/hub/request-password-reset",
		hubauth.RequestPasswordReset(s),
	)
	mux.HandleFunc(
		"POST /api/hub/complete-password-reset",
		hubauth.CompletePasswordReset(s),
	)
	mux.Handle(
		"POST /api/hub/change-password",
		hubAuth(recentAuth(hubauth.ChangePassword(s))),
	)
	mux.Handle(
		"POST /api/hub/start-totp-enrollment",
		hubAuth(recentAuth(hubauth.StartTOTPEnrollment(s))),
	)
	mux.Handle(
		"POST /api/hub/confirm-totp-enrollment",
		hubAuth(hubauth.ConfirmTOTPEnrollment(s)),
	)
	mux.Handle(
		"POST /api/hub/disable-totp",
		hubAuth(recentAuth(hubauth.DisableTOTP(s))),
	)
	mux.Handle(
		"POST /api/hub/regenerate-totp-recovery-codes",
		hubAuth(recentAuth(hubauth.RegenerateTOTPRecoveryCodes(s))),
	)
	mux.Handle("GET /api/hub/my-info", hubAuth(hubusers.MyInfo(s)))
	mux.Handle(
		"POST /api/hub/set-preferred-language",
		hubAuth(hubusers.SetPreferredLanguage(s)),
	)
	mux.Handle(
		"POST /api/hub/set-resident-country",
		hubAuth(hubusers.SetResidentCountry(s)),
	)
}
