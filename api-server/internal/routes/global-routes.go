package routes

import (
	"net/http"

	"vetchium-api-server.gomodule/handlers/global"
	"vetchium-api-server.gomodule/internal/server"
)

func RegisterGlobalRoutes(mux *http.ServeMux, s *server.Server) {
	// Public unauthenticated routes
	mux.HandleFunc("POST /global/get-regions", global.GetRegions(s))
	mux.HandleFunc("POST /global/get-supported-languages", global.GetSupportedLanguages(s))
	mux.HandleFunc("POST /global/check-domain", global.CheckDomain(s))
}
