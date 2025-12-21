package main

import (
	"net/http"

	"vetchium-api-server.gomodule/handlers/admin"
	"vetchium-api-server.gomodule/internal/server"
)

func registerAdminRoutes(mux *http.ServeMux, s *server.Server) {
	mux.HandleFunc("POST /admin/login", admin.Login(s))
	mux.HandleFunc("POST /admin/tfa", admin.TFA(s))
	mux.HandleFunc("POST /admin/logout", admin.Logout(s))
}
