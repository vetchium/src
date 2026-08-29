package routes

import (
	"net/http"
	"time"

	"backend/handlers/hub"
	"backend/handlers/portal"
	"backend/internal/apiserver"
	"backend/internal/hubapi"
	"backend/internal/middleware"
)

func RegisterHubRoutes(mux *http.ServeMux, s *hubapi.Server) {
	mux.HandleFunc("GET /healthz", apiserver.HealthCheck)
	mux.HandleFunc(
		"GET /api/hub/ping", portal.Ping(s.Runtime, s.Queries, "hub", s.TenantID),
	)

	hubAuth := middleware.HubAuth(s)
	recentAuth := middleware.RequireRecentHubAuthentication(s, 5*time.Minute)
	mux.HandleFunc("POST /api/hub/request-signup", hub.RequestSignup(s))
	mux.HandleFunc("POST /api/hub/complete-signup", hub.CompleteSignup(s))
	mux.HandleFunc("POST /api/hub/login", hub.Login(s))
	mux.HandleFunc("POST /api/hub/login/tfa", hub.VerifyTFA(s))
	mux.HandleFunc(
		"POST /api/hub/login/recovery-code", hub.VerifyRecoveryCode(s),
	)
	mux.HandleFunc("POST /api/hub/logout", hub.Logout(s))
	mux.Handle(
		"POST /api/hub/reauthenticate",
		hubAuth(hub.Reauthenticate(s)),
	)
	mux.HandleFunc(
		"POST /api/hub/request-password-reset",
		hub.RequestPasswordReset(s),
	)
	mux.HandleFunc(
		"POST /api/hub/complete-password-reset",
		hub.CompletePasswordReset(s),
	)
	mux.Handle(
		"POST /api/hub/change-password",
		hubAuth(recentAuth(hub.ChangePassword(s))),
	)
	mux.Handle(
		"POST /api/hub/start-totp-enrollment",
		hubAuth(recentAuth(hub.StartTOTPEnrollment(s))),
	)
	mux.Handle(
		"POST /api/hub/confirm-totp-enrollment",
		hubAuth(hub.ConfirmTOTPEnrollment(s)),
	)
	mux.Handle(
		"POST /api/hub/disable-totp",
		hubAuth(recentAuth(hub.DisableTOTP(s))),
	)
	mux.Handle(
		"POST /api/hub/regenerate-totp-recovery-codes",
		hubAuth(recentAuth(hub.RegenerateTOTPRecoveryCodes(s))),
	)
	mux.Handle("GET /api/hub/my-info", hubAuth(hub.MyInfo(s)))
	mux.Handle(
		"POST /api/hub/set-preferred-language",
		hubAuth(hub.SetPreferredLanguage(s)),
	)
	mux.Handle(
		"POST /api/hub/set-resident-country",
		hubAuth(hub.SetResidentCountry(s)),
	)
}
