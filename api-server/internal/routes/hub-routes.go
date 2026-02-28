package routes

import (
	"net/http"

	"vetchium-api-server.gomodule/handlers/hub"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
)

func RegisterHubRoutes(mux *http.ServeMux, s *server.Server) {
	// Unauthenticated routes
	mux.HandleFunc("POST /hub/request-signup", hub.RequestSignup(s))
	mux.HandleFunc("POST /hub/complete-signup", hub.CompleteSignup(s))
	mux.HandleFunc("POST /hub/login", hub.Login(s))
	mux.HandleFunc("POST /hub/tfa", hub.TFA(s))
	mux.HandleFunc("POST /hub/request-password-reset", hub.RequestPasswordReset(s))
	mux.HandleFunc("POST /hub/complete-password-reset", hub.CompletePasswordReset(s))
	mux.HandleFunc("POST /hub/complete-email-change", hub.CompleteEmailChange(s))

	// Authenticated routes (require Authorization header)
	hubAuth := middleware.HubAuth(s.Regional, s.CurrentRegion, s.InternalEndpoints)
	mux.Handle("POST /hub/logout", hubAuth(hub.Logout(s)))
	mux.Handle("POST /hub/set-language", hubAuth(hub.SetLanguage(s)))
	mux.Handle("POST /hub/change-password", hubAuth(hub.ChangePassword(s)))
	mux.Handle("POST /hub/request-email-change", hubAuth(hub.RequestEmailChange(s)))
	mux.Handle("GET /hub/myinfo", hubAuth(hub.MyInfo(s)))

	// Tag read routes (auth-only, no role restriction)
	mux.Handle("POST /hub/get-tag", hubAuth(hub.GetTag(s)))
	mux.Handle("POST /hub/filter-tags", hubAuth(hub.FilterTags(s)))
}
