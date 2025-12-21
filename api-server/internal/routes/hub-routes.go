package routes

import (
	"net/http"

	"vetchium-api-server.gomodule/handlers/hub"
	"vetchium-api-server.gomodule/internal/server"
)

func RegisterHubRoutes(mux *http.ServeMux, s *server.Server) {
	mux.HandleFunc("POST /hub/login", hub.Login(s))
}
