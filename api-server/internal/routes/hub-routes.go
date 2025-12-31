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

	// Authenticated routes (require Authorization header)
	authMiddleware := middleware.HubAuth(s.Global)
	mux.Handle("POST /hub/logout", authMiddleware(hub.Logout(s)))
}
