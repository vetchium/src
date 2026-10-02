package routes

import (
	"net/http"

	orgsaccount "backend/handlers/orgs/account"
	orgsauth "backend/handlers/orgs/auth"
	orgssettings "backend/handlers/orgs/settings"
	orgssubscriptions "backend/handlers/orgs/subscriptions"
	orgsusers "backend/handlers/orgs/users"
	"backend/handlers/portal"
	"backend/internal/apiserver"
	"backend/internal/middleware"
	orgsruntime "backend/internal/orgs"

	orgsauthorization "github.com/vetchium/src/typespec/orgs/authorization"
)

func RegisterOrgsRoutes(mux *http.ServeMux, s *orgsruntime.Server) {
	mux.HandleFunc("GET /healthz", apiserver.HealthCheck)
	mux.HandleFunc(
		"GET /api/orgs/ping",
		portal.Ping(s.Runtime, s.Queries, "orgs", s.TenantID),
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

	// A suspended Org is refused on every route below; the account and billing
	// routes it keeps do not compose activeOrg.
	activeOrg := middleware.RequireActiveOrg(s)
	manageUsers := func(next http.Handler) http.Handler {
		return orgAuth(activeOrg(
			middleware.RequireOrgPermission(
				s, orgsauthorization.ManageUsers,
			)(next),
		))
	}
	mux.Handle("POST /api/orgs/invite-users", manageUsers(orgsusers.InviteUsers(s)))
	mux.Handle(
		"POST /api/orgs/list-invitations", manageUsers(orgsusers.ListInvitations(s)),
	)
	mux.Handle(
		"POST /api/orgs/resend-invitation",
		manageUsers(orgsusers.ResendInvitation(s)),
	)
	mux.Handle(
		"POST /api/orgs/cancel-invitations",
		manageUsers(orgsusers.CancelInvitations(s)),
	)
	mux.HandleFunc(
		"POST /api/orgs/get-invitation-details", orgsusers.GetInvitationDetails(s),
	)
	mux.HandleFunc(
		"POST /api/orgs/accept-invitation", orgsusers.AcceptInvitation(s),
	)
	mux.Handle("POST /api/orgs/list-users", manageUsers(orgsusers.ListUsers(s)))
	mux.Handle("POST /api/orgs/user-summary", manageUsers(orgsusers.UserSummary(s)))
	mux.Handle("POST /api/orgs/disable-user", manageUsers(orgsusers.DisableUser(s)))
	mux.Handle(
		"POST /api/orgs/bulk-disable-users",
		manageUsers(orgsusers.BulkDisableUsers(s)),
	)
	mux.Handle("POST /api/orgs/enable-user", manageUsers(orgsusers.EnableUser(s)))
	mux.Handle(
		"POST /api/orgs/bulk-enable-users",
		manageUsers(orgsusers.BulkEnableUsers(s)),
	)
	mux.Handle(
		"POST /api/orgs/set-user-permissions",
		manageUsers(recentAuth(orgsusers.SetUserPermissions(s))),
	)
	mux.Handle(
		"POST /api/orgs/bulk-set-user-permissions",
		manageUsers(recentAuth(orgsusers.BulkSetUserPermissions(s))),
	)
	mux.Handle(
		"GET /api/orgs/list-permissions", orgAuth(orgsusers.ListPermissions(s)),
	)

	// Billing stays open to a suspended Org so it can still pay (D27), except
	// for choosing a plan.
	manageBilling := func(next http.Handler) http.Handler {
		return orgAuth(middleware.RequireOrgPermission(
			s, orgsauthorization.ManageBilling,
		)(next))
	}
	mux.Handle(
		"GET /api/orgs/my-subscription",
		manageBilling(orgssubscriptions.MySubscription(s)),
	)
	mux.Handle(
		"POST /api/orgs/set-subscription-plan",
		orgAuth(activeOrg(middleware.RequireOrgPermission(
			s, orgsauthorization.ManageBilling,
		)(orgssubscriptions.SetSubscriptionPlan(s)))),
	)
	mux.Handle(
		"POST /api/orgs/set-payment-method",
		manageBilling(orgssubscriptions.SetPaymentMethod(s)),
	)
	mux.Handle(
		"POST /api/orgs/remove-payment-method",
		manageBilling(orgssubscriptions.RemovePaymentMethod(s)),
	)
	mux.Handle(
		"POST /api/orgs/list-invoices",
		manageBilling(orgssubscriptions.ListInvoices(s)),
	)
	mux.Handle(
		"POST /api/orgs/pay-invoice",
		manageBilling(orgssubscriptions.PayInvoice(s)),
	)

	manageOrg := func(next http.Handler) http.Handler {
		return orgAuth(activeOrg(middleware.RequireOrgPermission(
			s, orgsauthorization.Superadmin,
		)(next)))
	}
	mux.Handle("POST /api/orgs/logo/upload", manageOrg(orgssettings.UploadLogo(s)))
	mux.Handle("POST /api/orgs/logo/remove", manageOrg(orgssettings.RemoveLogo(s)))
}
