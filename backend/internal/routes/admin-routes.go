package routes

import (
	"net/http"
	"time"

	"github.com/vetchium/src/typespec/admin/authorization"

	"backend/handlers/admin"
	"backend/internal/adminapi"
	"backend/internal/middleware"
)

func RegisterAdminRoutes(mux *http.ServeMux, s *adminapi.Server) {
	adminAuth := middleware.AdminAuth(s)
	recentAuth := middleware.RequireRecentAdminAuthentication(
		s, 5*time.Minute,
	)
	superadmin := middleware.RequireSuperadmin(s)
	viewUsers := middleware.RequireAdminPermission(
		s, string(authorization.ViewUsers),
	)
	manageUsers := middleware.RequireAdminPermission(
		s, string(authorization.ManageUsers),
	)

	mux.HandleFunc("POST /api/admin/login", admin.Login(s))
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
	mux.HandleFunc(
		"GET /api/admin/company-regional-defaults",
		admin.CompanyRegionalDefaults(s),
	)
	mux.Handle(
		"POST /api/admin/set-company-regional-defaults",
		adminAuth(superadmin(admin.SetCompanyRegionalDefaults(s))),
	)
	mux.Handle(
		"POST /api/admin/grant-permission",
		adminAuth(superadmin(admin.GrantPermission(s))),
	)
	mux.Handle(
		"POST /api/admin/revoke-permission",
		adminAuth(superadmin(admin.RevokePermission(s))),
	)
	mux.Handle(
		"POST /api/admin/promote-to-superadmin",
		adminAuth(superadmin(recentAuth(admin.PromoteToSuperadmin(s)))),
	)
	mux.Handle(
		"POST /api/admin/demote-from-superadmin",
		adminAuth(superadmin(recentAuth(admin.DemoteFromSuperadmin(s)))),
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
	mux.Handle("GET /api/admin/my-info", adminAuth(admin.MyInfo(s)))
	mux.Handle(
		"POST /api/admin/set-preferred-language",
		adminAuth(admin.SetPreferredLanguage(s)),
	)
	mux.Handle(
		"POST /api/admin/set-preferred-timezone",
		adminAuth(admin.SetPreferredTimezone(s)),
	)
	mux.Handle(
		"POST /api/admin/set-display-names",
		adminAuth(admin.SetDisplayNames(s)),
	)
}
