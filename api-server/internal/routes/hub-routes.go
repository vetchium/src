package routes

import (
	"net/http"

	"vetchium-api-server.gomodule/handlers/hub"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
)

func RegisterHubRoutes(mux *http.ServeMux, s *server.RegionalServer) {
	// Unauthenticated routes
	mux.HandleFunc("POST /hub/request-signup", hub.RequestSignup(s))
	mux.HandleFunc("POST /hub/complete-signup", hub.CompleteSignup(s))
	mux.HandleFunc("POST /hub/login", hub.Login(s))
	mux.HandleFunc("POST /hub/tfa", hub.TFA(s))
	mux.HandleFunc("POST /hub/request-password-reset", hub.RequestPasswordReset(s))
	mux.HandleFunc("POST /hub/complete-password-reset", hub.CompletePasswordReset(s))
	mux.HandleFunc("POST /hub/complete-email-change", hub.CompleteEmailChange(s))

	// Authenticated routes (require Authorization header)
	hubAuth := middleware.HubAuth(s.AllRegionalDBs)
	mux.Handle("POST /hub/logout", hubAuth(hub.Logout(s)))
	mux.Handle("POST /hub/set-language", hubAuth(hub.SetLanguage(s)))
	mux.Handle("POST /hub/change-password", hubAuth(hub.ChangePassword(s)))
	mux.Handle("POST /hub/request-email-change", hubAuth(hub.RequestEmailChange(s)))
	mux.Handle("GET /hub/myinfo", hubAuth(hub.MyInfo(s)))

	// Tag read routes (auth-only, no role restriction)
	mux.Handle("POST /hub/get-tag", hubAuth(hub.GetTag(s)))
	mux.Handle("POST /hub/list-tags", hubAuth(hub.FilterTags(s)))

	// Audit log routes (auth-only, no role required)
	mux.Handle("POST /hub/list-audit-logs", hubAuth(hub.MyAuditLogs(s)))

	// Profile routes (auth-only, no role restriction)
	mux.Handle("GET /hub/get-my-profile", hubAuth(hub.GetMyProfile(s)))
	mux.Handle("POST /hub/update-my-profile", hubAuth(hub.UpdateMyProfile(s)))
	mux.Handle("POST /hub/upload-profile-picture", hubAuth(hub.UploadProfilePicture(s)))
	mux.Handle("POST /hub/remove-profile-picture", hubAuth(hub.RemoveProfilePicture(s)))
	mux.Handle("POST /hub/get-profile", hubAuth(hub.GetProfile(s)))
	mux.Handle("GET /hub/profile-picture/{handle}", hubAuth(hub.GetProfilePicture(s)))

	// Work email routes (auth-only, no role restriction)
	mux.Handle("POST /hub/add-work-email", hubAuth(hub.AddWorkEmail(s)))
	mux.Handle("POST /hub/verify-work-email", hubAuth(hub.VerifyWorkEmail(s)))
	mux.Handle("POST /hub/resend-work-email-code", hubAuth(hub.ResendWorkEmailCode(s)))
	mux.Handle("POST /hub/reverify-work-email", hubAuth(hub.ReverifyWorkEmail(s)))
	mux.Handle("POST /hub/remove-work-email", hubAuth(hub.RemoveWorkEmail(s)))
	mux.Handle("POST /hub/list-my-work-emails", hubAuth(hub.ListMyWorkEmails(s)))
	mux.Handle("POST /hub/get-my-work-email", hubAuth(hub.GetMyWorkEmail(s)))
	mux.Handle("POST /hub/list-public-employer-stints", hubAuth(hub.ListPublicEmployerStints(s)))

	// Connection routes (auth-only, no role restriction)
	mux.Handle("POST /hub/connections/send-request", hubAuth(hub.SendConnectionRequest(s)))
	mux.Handle("POST /hub/connections/accept-request", hubAuth(hub.AcceptConnectionRequest(s)))
	mux.Handle("POST /hub/connections/reject-request", hubAuth(hub.RejectConnectionRequest(s)))
	mux.Handle("POST /hub/connections/withdraw-request", hubAuth(hub.WithdrawConnectionRequest(s)))
	mux.Handle("POST /hub/connections/disconnect", hubAuth(hub.DisconnectConnection(s)))
	mux.Handle("POST /hub/connections/list", hubAuth(hub.ListConnections(s)))
	mux.Handle("POST /hub/connections/list-incoming-requests", hubAuth(hub.ListIncomingRequests(s)))
	mux.Handle("POST /hub/connections/list-outgoing-requests", hubAuth(hub.ListOutgoingRequests(s)))
	mux.Handle("POST /hub/connections/get-status", hubAuth(hub.GetConnectionStatus(s)))
	mux.Handle("POST /hub/connections/search", hubAuth(hub.SearchConnections(s)))
	mux.Handle("GET /hub/connections/counts", hubAuth(hub.GetConnectionCounts(s)))
	mux.Handle("POST /hub/connections/block", hubAuth(hub.BlockHubUser(s)))
	mux.Handle("POST /hub/connections/unblock", hubAuth(hub.UnblockHubUser(s)))
	mux.Handle("POST /hub/connections/list-blocked", hubAuth(hub.ListBlocked(s)))

	// Hiring routes (auth-only, no role restriction)
	mux.Handle("POST /hub/list-openings", hubAuth(hub.ListOpenings(s)))
	mux.Handle("POST /hub/get-opening", hubAuth(hub.GetOpening(s)))
	mux.Handle("POST /hub/apply-for-opening", hubAuth(hub.ApplyForOpening(s)))
	mux.Handle("POST /hub/list-my-applications", hubAuth(hub.ListMyApplications(s)))
	mux.Handle("POST /hub/get-my-application", hubAuth(hub.GetMyApplication(s)))
	mux.Handle("POST /hub/withdraw-application", hubAuth(hub.WithdrawApplication(s)))
	mux.Handle("POST /hub/list-my-candidacies", hubAuth(hub.ListMyCandidacies(s)))
	mux.Handle("POST /hub/get-my-candidacy", hubAuth(hub.GetMyCandidacy(s)))
	mux.Handle("POST /hub/rsvp-interview", hubAuth(hub.RSVPInterview(s)))
	mux.Handle("POST /hub/list-my-interviews", hubAuth(hub.ListMyInterviews(s)))
	mux.Handle("POST /hub/add-candidacy-comment", hubAuth(hub.AddCandidacyComment(s)))
	mux.Handle("POST /hub/get-apply-preferences", hubAuth(hub.GetApplyPreferences(s)))
	mux.Handle("POST /hub/set-notify-connections-on-apply", hubAuth(hub.SetNotifyConnectionsOnApply(s)))
	mux.Handle("POST /hub/set-allow-unsolicited-endorsements", hubAuth(hub.SetAllowUnsolicitedEndorsements(s)))
	mux.Handle("POST /hub/list-network-opportunities", hubAuth(hub.ListNetworkOpportunities(s)))
	mux.Handle("POST /hub/list-colleagues-at-employer", hubAuth(hub.ListColleaguesAtEmployer(s)))

	// Endorsement routes (T3)
	mux.Handle("POST /hub/request-endorsements", hubAuth(hub.RequestEndorsements(s)))
	mux.Handle("POST /hub/list-endorsement-requests-incoming", hubAuth(hub.ListEndorsementRequestsIncoming(s)))
	mux.Handle("POST /hub/list-endorsement-requests-outgoing", hubAuth(hub.ListEndorsementRequestsOutgoing(s)))
	mux.Handle("POST /hub/write-endorsement", hubAuth(hub.WriteEndorsement(s)))
	mux.Handle("POST /hub/update-endorsement", hubAuth(hub.UpdateEndorsement(s)))
	mux.Handle("POST /hub/decline-endorsement-request", hubAuth(hub.DeclineEndorsementRequest(s)))
	mux.Handle("POST /hub/hide-endorsement-on-application", hubAuth(hub.HideEndorsementOnApplication(s)))
	mux.Handle("POST /hub/show-endorsement-on-application", hubAuth(hub.ShowEndorsementOnApplication(s)))

	// Referral routes (T3)
	mux.Handle("POST /hub/nominate-colleague-for-role", hubAuth(hub.NominateColleagueForRole(s)))
	mux.Handle("POST /hub/list-referrals-received", hubAuth(hub.ListReferralsReceived(s)))
	mux.Handle("POST /hub/list-referrals-made", hubAuth(hub.ListReferralsMade(s)))
	mux.Handle("POST /hub/accept-referral", hubAuth(hub.AcceptReferral(s)))
	mux.Handle("POST /hub/decline-referral", hubAuth(hub.DeclineReferral(s)))

	// Reference routes (T4)
	mux.Handle("POST /hub/list-reference-requests-incoming", hubAuth(hub.ListReferenceRequestsIncoming(s)))
	mux.Handle("POST /hub/nominate-references", hubAuth(hub.NominateReferences(s)))
	mux.Handle("POST /hub/accept-reference-nomination", hubAuth(hub.AcceptReferenceNomination(s)))
	mux.Handle("POST /hub/decline-reference-nomination", hubAuth(hub.DeclineReferenceNomination(s)))
	mux.Handle("POST /hub/submit-reference-response", hubAuth(hub.SubmitReferenceResponse(s)))
}
