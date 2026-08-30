package routes

import (
	"net/http"

	"github.com/vetchium/src/typespec/admin/authorization"

	adminauth "backend/handlers/admin/auth"
	adminauthorization "backend/handlers/admin/authorization"
	adminsignupdomains "backend/handlers/admin/hubsignupdomains"
	adminusers "backend/handlers/admin/users"
	adminruntime "backend/internal/admin"
	"backend/internal/apiserver"
	"backend/internal/middleware"
)

func RegisterAdminRoutes(mux *http.ServeMux, s *adminruntime.Server) {
	mux.HandleFunc("GET /healthz", apiserver.HealthCheck)

	adminAuth := middleware.AdminAuth(s)
	recentAuth := middleware.RequireRecentAdminAuthentication(
		s, middleware.RecentAuthenticationWindow,
	)
	viewUsers := middleware.RequireAdminPermission(
		s, string(authorization.ViewUsers),
	)
	manageUsers := middleware.RequireAdminPermission(
		s, string(authorization.ManageUsers),
	)
	viewHubSignupDomains := middleware.RequireAdminPermission(
		s, string(authorization.ViewHubSignupDomains),
	)
	manageHubSignupDomains := middleware.RequireAdminPermission(
		s, string(authorization.ManageHubSignupDomains),
	)

	mux.HandleFunc("POST /api/admin/login", adminauth.Login(s))
	mux.Handle(
		"POST /api/admin/reauthenticate",
		adminAuth(adminauth.Reauthenticate(s)),
	)
	mux.HandleFunc("POST /api/admin/login/tfa", adminauth.VerifyTFA(s))
	mux.HandleFunc(
		"POST /api/admin/login/recovery-code",
		adminauth.VerifyRecoveryCode(s),
	)
	mux.HandleFunc("POST /api/admin/logout", adminauth.Logout(s))
	mux.HandleFunc(
		"POST /api/admin/request-password-reset",
		adminauth.RequestPasswordReset(s),
	)
	mux.HandleFunc(
		"POST /api/admin/complete-password-reset",
		adminauth.CompletePasswordReset(s),
	)
	mux.Handle(
		"POST /api/admin/change-password",
		adminAuth(recentAuth(adminauth.ChangePassword(s))),
	)
	mux.Handle(
		"POST /api/admin/start-totp-enrollment",
		adminAuth(recentAuth(adminauth.StartTOTPEnrollment(s))),
	)
	mux.Handle(
		"POST /api/admin/confirm-totp-enrollment",
		adminAuth(adminauth.ConfirmTOTPEnrollment(s)),
	)
	mux.Handle(
		"POST /api/admin/disable-totp",
		adminAuth(recentAuth(adminauth.DisableTOTP(s))),
	)
	mux.Handle(
		"POST /api/admin/regenerate-totp-recovery-codes",
		adminAuth(recentAuth(adminauth.RegenerateTOTPRecoveryCodes(s))),
	)
	mux.Handle(
		"POST /api/admin/set-user-permissions",
		adminAuth(manageUsers(recentAuth(adminauthorization.SetPermissions(s)))),
	)
	mux.Handle(
		"POST /api/admin/invite-user",
		adminAuth(manageUsers(adminusers.InviteUser(s))),
	)
	mux.HandleFunc("POST /api/admin/complete-setup", adminusers.CompleteSetup(s))
	mux.Handle(
		"POST /api/admin/list-users",
		adminAuth(viewUsers(adminusers.ListUsers(s))),
	)
	mux.Handle(
		"POST /api/admin/disable-user",
		adminAuth(manageUsers(adminusers.DisableUser(s))),
	)
	mux.Handle(
		"POST /api/admin/enable-user",
		adminAuth(manageUsers(adminusers.EnableUser(s))),
	)
	mux.Handle(
		"POST /api/admin/list-hub-signup-domains",
		adminAuth(viewHubSignupDomains(adminsignupdomains.ListHubSignupDomains(s))),
	)
	mux.Handle(
		"POST /api/admin/create-hub-signup-domain",
		adminAuth(manageHubSignupDomains(
			adminsignupdomains.CreateHubSignupDomain(s),
		)),
	)
	mux.Handle(
		"POST /api/admin/update-hub-signup-domain",
		adminAuth(manageHubSignupDomains(
			adminsignupdomains.UpdateHubSignupDomain(s),
		)),
	)
	mux.Handle("GET /api/admin/my-info", adminAuth(adminusers.MyInfo(s)))
	mux.Handle(
		"POST /api/admin/set-preferred-language",
		adminAuth(adminusers.SetPreferredLanguage(s)),
	)
	mux.Handle(
		"POST /api/admin/set-display-name",
		adminAuth(adminusers.SetDisplayName(s)),
	)
}
