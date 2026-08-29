package routes

import (
	"net/http"

	"github.com/vetchium/src/typespec/admin/authorization"

	"backend/handlers/admin"
	"backend/internal/adminapi"
	"backend/internal/apiserver"
	"backend/internal/middleware"
)

func RegisterAdminRoutes(mux *http.ServeMux, s *adminapi.Server) {
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

	mux.HandleFunc("POST /api/admin/login", admin.Login(s))
	mux.Handle(
		"POST /api/admin/reauthenticate",
		adminAuth(admin.Reauthenticate(s)),
	)
	mux.HandleFunc("POST /api/admin/login/tfa", admin.VerifyTFA(s))
	mux.HandleFunc("POST /api/admin/login/recovery-code", admin.VerifyRecoveryCode(s))
	mux.HandleFunc("POST /api/admin/logout", admin.Logout(s))
	mux.HandleFunc(
		"POST /api/admin/request-password-reset",
		admin.RequestPasswordReset(s),
	)
	mux.HandleFunc(
		"POST /api/admin/complete-password-reset",
		admin.CompletePasswordReset(s),
	)
	mux.Handle(
		"POST /api/admin/change-password",
		adminAuth(recentAuth(admin.ChangePassword(s))),
	)
	mux.Handle(
		"POST /api/admin/start-totp-enrollment",
		adminAuth(recentAuth(admin.StartTOTPEnrollment(s))),
	)
	mux.Handle(
		"POST /api/admin/confirm-totp-enrollment",
		adminAuth(admin.ConfirmTOTPEnrollment(s)),
	)
	mux.Handle(
		"POST /api/admin/disable-totp",
		adminAuth(recentAuth(admin.DisableTOTP(s))),
	)
	mux.Handle(
		"POST /api/admin/regenerate-totp-recovery-codes",
		adminAuth(recentAuth(admin.RegenerateTOTPRecoveryCodes(s))),
	)
	mux.Handle(
		"POST /api/admin/set-user-permissions",
		adminAuth(manageUsers(recentAuth(admin.SetPermissions(s)))),
	)
	mux.Handle(
		"POST /api/admin/invite-user",
		adminAuth(manageUsers(admin.InviteUser(s))),
	)
	mux.HandleFunc("POST /api/admin/complete-setup", admin.CompleteSetup(s))
	mux.Handle(
		"POST /api/admin/list-users",
		adminAuth(viewUsers(admin.ListUsers(s))),
	)
	mux.Handle(
		"POST /api/admin/disable-user",
		adminAuth(manageUsers(admin.DisableUser(s))),
	)
	mux.Handle(
		"POST /api/admin/enable-user",
		adminAuth(manageUsers(admin.EnableUser(s))),
	)
	mux.Handle(
		"POST /api/admin/list-hub-signup-domains",
		adminAuth(viewHubSignupDomains(admin.ListHubSignupDomains(s))),
	)
	mux.Handle(
		"POST /api/admin/create-hub-signup-domain",
		adminAuth(manageHubSignupDomains(admin.CreateHubSignupDomain(s))),
	)
	mux.Handle(
		"POST /api/admin/update-hub-signup-domain",
		adminAuth(manageHubSignupDomains(admin.UpdateHubSignupDomain(s))),
	)
	mux.Handle("GET /api/admin/my-info", adminAuth(admin.MyInfo(s)))
	mux.Handle(
		"POST /api/admin/set-preferred-language",
		adminAuth(admin.SetPreferredLanguage(s)),
	)
	mux.Handle(
		"POST /api/admin/set-display-name",
		adminAuth(admin.SetDisplayName(s)),
	)
}
