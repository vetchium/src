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
}
