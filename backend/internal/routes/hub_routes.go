package routes

import (
	"net/http"

	hubauth "backend/handlers/hub/auth"
	huboperations "backend/handlers/hub/operations"
	hubprofile "backend/handlers/hub/profile"
	hubsubscriptions "backend/handlers/hub/subscriptions"
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
		"POST /api/hub/request-email-change",
		hubAuth(recentAuth(hubauth.RequestEmailChange(s))),
	)
	mux.Handle(
		"POST /api/hub/confirm-email-change",
		hubAuth(hubauth.ConfirmEmailChange(s)),
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
	mux.Handle("POST /api/hub/set-preferred-job-countries", hubAuth(hubusers.SetPreferredJobCountries(s)))
	mux.Handle(
		"POST /api/hub/set-preferred-language",
		hubAuth(hubusers.SetPreferredLanguage(s)),
	)
	mux.Handle(
		"POST /api/hub/set-resident-country",
		hubAuth(hubusers.SetResidentCountry(s)),
	)
	mux.Handle(
		"GET /api/hub/my-subscription",
		hubAuth(hubsubscriptions.MySubscription(s)),
	)
	mux.Handle(
		"POST /api/hub/set-subscription-plan",
		hubAuth(hubsubscriptions.SetSubscriptionPlan(s)),
	)
	mux.Handle(
		"POST /api/hub/profile/set-public-fields",
		hubAuth(hubprofile.SetPublicFields(s)),
	)
	mux.Handle("POST /api/hub/profile/save-certification",
		hubAuth(hubprofile.SaveCertification(s)))
	mux.Handle("POST /api/hub/profile/delete-certification",
		hubAuth(hubprofile.DeleteCertification(s)))
	mux.Handle("POST /api/hub/profile/save-website",
		hubAuth(hubprofile.SaveWebsite(s)))
	mux.Handle("POST /api/hub/profile/delete-website",
		hubAuth(hubprofile.DeleteWebsite(s)))
	mux.Handle("POST /api/hub/profile/add-language",
		hubAuth(hubprofile.AddLanguageAbility(s)))
	mux.Handle("POST /api/hub/profile/delete-language",
		hubAuth(hubprofile.DeleteLanguageAbility(s)))
	mux.Handle("POST /api/hub/profile/save-work-experience",
		hubAuth(hubprofile.SaveWorkExperience(s)))
	mux.Handle("POST /api/hub/profile/delete-work-experience",
		hubAuth(hubprofile.DeleteWorkExperience(s)))
	mux.Handle("POST /api/hub/profile/save-education",
		hubAuth(hubprofile.SaveEducation(s)))
	mux.Handle("POST /api/hub/profile/delete-education",
		hubAuth(hubprofile.DeleteEducation(s)))
	mux.Handle("POST /api/hub/profile/read",
		hubAuth(hubprofile.Read(s)))
	mux.Handle("POST /api/hub/profile/professional-email/list",
		hubAuth(hubprofile.ListProfessionalEmails(s)))
	mux.Handle("POST /api/hub/profile/professional-email/add",
		hubAuth(hubprofile.AddProfessionalEmail(s)))
	mux.Handle("POST /api/hub/profile/professional-email/delete",
		hubAuth(hubprofile.DeleteProfessionalEmail(s)))
	mux.Handle("POST /api/hub/profile/professional-email/request-code",
		hubAuth(hubprofile.RequestProfessionalEmailCode(s)))
	mux.Handle("POST /api/hub/profile/professional-email/verify",
		hubAuth(hubprofile.VerifyProfessionalEmailCode(s)))
	mux.Handle("POST /api/hub/profile/picture/remove",
		hubAuth(hubprofile.RemovePicture(s)))
	mux.Handle("POST /api/hub/profile/picture/upload",
		hubAuth(hubprofile.UploadPicture(s)))
	mux.Handle("GET /api/hub/profile/alias/state",
		hubAuth(hubprofile.AliasState(s)))
	mux.Handle("POST /api/hub/profile/alias/set",
		hubAuth(hubprofile.SetAlias(s)))
	mux.Handle("POST /api/hub/operations/status",
		hubAuth(huboperations.Status(s)))
}
