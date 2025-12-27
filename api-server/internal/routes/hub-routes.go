package routes

import (
	"net/http"

	"vetchium-api-server.gomodule/handlers/hub"
	"vetchium-api-server.gomodule/internal/middleware"
	"vetchium-api-server.gomodule/internal/server"
)

func RegisterHubRoutes(mux *http.ServeMux, s *server.Server) {
	// Unauthenticated routes
	mux.HandleFunc("POST /hub/get-regions", hub.GetRegions(s))
	mux.HandleFunc("POST /hub/get-supported-languages", hub.GetSupportedLanguages(s))
	mux.HandleFunc("POST /hub/check-domain", hub.CheckDomain(s))
	mux.HandleFunc("POST /hub/request-signup", hub.RequestSignup(s))
	mux.HandleFunc("POST /hub/complete-signup", hub.CompleteSignup(s))
	mux.HandleFunc("POST /hub/login", hub.Login(s))

	// Authenticated routes
	authMiddleware := middleware.HubAuth(s.Global)
	mux.Handle("POST /hub/logout", authMiddleware(http.HandlerFunc(hub.Logout(s))))
}
