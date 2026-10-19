package routes

import (
	"net/http"

	orgsaccount "backend/handlers/orgs/account"
	orgsai "backend/handlers/orgs/ai"
	orgsapplications "backend/handlers/orgs/applications"
	orgsauth "backend/handlers/orgs/auth"
	orgsopenings "backend/handlers/orgs/openings"
	orgsoperations "backend/handlers/orgs/operations"
	orgspipelines "backend/handlers/orgs/pipelines"
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
	mux.HandleFunc("POST /api/orgs/sso/google/start", orgsauth.StartGoogleSignIn(s))
	mux.HandleFunc(
		"POST /api/orgs/sso/google/complete", orgsauth.CompleteGoogleSignIn(s),
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
	readOpening := func(next http.Handler) http.Handler {
		return orgAuth(activeOrg(next))
	}
	manageOpenings := func(next http.Handler) http.Handler {
		return orgAuth(activeOrg(middleware.RequireOrgPermission(
			s, orgsauthorization.ManageOpenings,
		)(next)))
	}
	mux.Handle(
		"POST /api/orgs/operations/status",
		orgAuth(activeOrg(orgsoperations.Status(s))),
	)
	mux.Handle("POST /api/orgs/create-opening", manageOpenings(orgsopenings.CreateOpening(s)))
	mux.Handle("POST /api/orgs/duplicate-opening", manageOpenings(orgsopenings.DuplicateOpening(s)))
	mux.Handle("POST /api/orgs/save-opening-working-copy", manageOpenings(orgsopenings.SaveOpeningWorkingCopy(s)))
	mux.Handle("POST /api/orgs/discard-opening-working-copy", manageOpenings(orgsopenings.DiscardOpeningWorkingCopy(s)))
	mux.Handle("POST /api/orgs/set-opening-team", manageOpenings(orgsopenings.SetOpeningTeam(s)))
	mux.Handle("POST /api/orgs/discard-opening", manageOpenings(orgsopenings.DiscardOpening(s)))
	mux.Handle("POST /api/orgs/request-opening-change", manageOpenings(orgsopenings.RequestOpeningChange(s)))
	mux.Handle("POST /api/orgs/decide-opening-request", orgAuth(activeOrg(middleware.RequireOrgPermission(s, orgsauthorization.ApproveOpenings)(orgsopenings.DecideOpeningRequest(s)))))
	mux.Handle("POST /api/orgs/withdraw-opening-request", readOpening(orgsopenings.WithdrawOpeningRequest(s)))
	mux.Handle("POST /api/orgs/get-opening", readOpening(orgsopenings.GetOpening(s)))
	mux.Handle("POST /api/orgs/list-openings", readOpening(orgsopenings.ListOpenings(s)))
	mux.Handle("POST /api/orgs/opening-summary", readOpening(orgsopenings.OpeningSummary(s)))
	mux.Handle("POST /api/orgs/lookup-opening-team-member", manageOpenings(orgsopenings.LookupOpeningTeamMember(s)))
	mux.Handle("POST /api/orgs/list-opening-history", readOpening(orgsopenings.ListOpeningHistory(s)))
	mux.Handle("POST /api/orgs/list-pipeline-templates", manageOpenings(orgspipelines.ListPipelineTemplates(s)))
	mux.Handle("POST /api/orgs/create-pipeline-template", manageOpenings(orgspipelines.CreatePipelineTemplate(s)))
	mux.Handle("POST /api/orgs/update-pipeline-template", manageOpenings(orgspipelines.UpdatePipelineTemplate(s)))
	mux.Handle("POST /api/orgs/delete-pipeline-template", manageOpenings(orgspipelines.DeletePipelineTemplate(s)))
	mux.Handle("POST /api/orgs/get-opening-pipeline", manageOpenings(orgspipelines.GetOpeningPipeline(s)))
	mux.Handle("POST /api/orgs/replace-opening-pipeline", manageOpenings(orgspipelines.ReplaceOpeningPipeline(s)))
	// Application reads are authorized in SQL by the Opening's team or
	// org:manage_candidacies; a caller without access gets the not-found an
	// unknown number gets.
	mux.Handle("POST /api/orgs/list-applications", readOpening(orgsapplications.ListApplications(s)))
	mux.Handle("POST /api/orgs/get-application", readOpening(orgsapplications.GetApplication(s)))
	mux.Handle("POST /api/orgs/get-application-counts", readOpening(orgsapplications.GetApplicationCounts(s)))
	mux.Handle("POST /api/orgs/list-application-history", readOpening(orgsapplications.ListApplicationHistory(s)))
	// Application writes check the caller's right to act in SQL (the Opening's
	// hiring manager or recruiter, or org:manage_candidacies); a caller who
	// may read but not act gets the permission problem.
	mux.Handle("POST /api/orgs/shortlist-application", readOpening(orgsapplications.ShortlistApplication(s)))
	mux.Handle("POST /api/orgs/move-application-stage", readOpening(orgsapplications.MoveApplicationStage(s)))
	mux.Handle("POST /api/orgs/complete-application-stage", readOpening(orgsapplications.CompleteApplicationStage(s)))
	mux.Handle("POST /api/orgs/mark-application-not-progressing", readOpening(orgsapplications.MarkApplicationNotProgressing(s)))
	mux.Handle("POST /api/orgs/record-application-joined", readOpening(orgsapplications.RecordApplicationJoined(s)))
	mux.Handle("POST /api/orgs/record-application-did-not-join", readOpening(orgsapplications.RecordApplicationDidNotJoin(s)))
	mux.Handle("POST /api/orgs/record-application-separated", readOpening(orgsapplications.RecordApplicationSeparated(s)))
	mux.Handle("POST /api/orgs/correct-application-joined-on", readOpening(orgsapplications.CorrectApplicationJoinedOn(s)))
	mux.Handle("POST /api/orgs/correct-application-separated-on", readOpening(orgsapplications.CorrectApplicationSeparatedOn(s)))
	mux.Handle("POST /api/orgs/upload-offer-letter", readOpening(orgsapplications.UploadOfferLetter(s)))
	mux.Handle("POST /api/orgs/extend-application-offer", readOpening(orgsapplications.ExtendApplicationOffer(s)))
	mux.Handle("POST /api/orgs/withdraw-application-offer", readOpening(orgsapplications.WithdrawApplicationOffer(s)))
	mux.Handle("POST /api/orgs/draft-opening-with-ai", manageOpenings(orgsai.DraftOpeningWithAI(s)))

	// The options a caller may use depend on the operation, whose permission
	// the handler checks.
	mux.Handle("POST /api/orgs/get-ai-options", orgAuth(activeOrg(orgsai.GetAIOptions(s))))
	manageAI := func(next http.Handler) http.Handler {
		return orgAuth(activeOrg(middleware.RequireOrgPermission(
			s, orgsauthorization.ManageAI,
		)(next)))
	}
	mux.Handle("GET /api/orgs/ai-settings", manageAI(orgsai.GetAISettings(s)))
	mux.Handle("POST /api/orgs/set-ai-settings", manageAI(orgsai.SetAISettings(s)))
	mux.Handle("GET /api/orgs/ai-credits", manageAI(orgsai.GetAICredits(s)))
	mux.Handle("POST /api/orgs/list-ai-credit-lots", manageAI(orgsai.ListAICreditLots(s)))
	mux.Handle("POST /api/orgs/buy-ai-credit-pack", manageAI(orgsai.BuyAICreditPack(s)))
	mux.Handle("POST /api/orgs/list-ai-usage", manageAI(orgsai.ListAIUsage(s)))
	mux.Handle("POST /api/orgs/get-ai-usage-text", manageAI(orgsai.GetAIUsageText(s)))
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

	// A suspended Org may read its plan but cannot change it.
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

	manageOrg := func(next http.Handler) http.Handler {
		return orgAuth(activeOrg(middleware.RequireOrgPermission(
			s, orgsauthorization.Superadmin,
		)(next)))
	}
	mux.Handle("POST /api/orgs/set-company-details", manageOrg(orgssettings.SetCompanyDetails(s)))
	mux.Handle("POST /api/orgs/logo/upload", manageOrg(orgssettings.UploadLogo(s)))
	mux.Handle("POST /api/orgs/logo/remove", manageOrg(orgssettings.RemoveLogo(s)))
	mux.Handle(
		"POST /api/orgs/set-google-sign-in",
		manageOrg(recentAuth(orgssettings.SetGoogleSignIn(s))),
	)
}
