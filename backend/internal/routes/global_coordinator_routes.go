package routes

import (
	"net/http"

	"backend/handlers/regions"
	"backend/internal/apiserver"
	"backend/internal/globalcoordinator"
)

func RegisterGlobalCoordinatorRoutes(
	mux *http.ServeMux, s *globalcoordinator.Server,
) {
	mux.HandleFunc("GET /healthz", apiserver.HealthCheck)
	mux.HandleFunc(
		"POST /api/global-coordinator/list-signup-regions",
		regions.Handler(s.Runtime, s.Regions, nil, s.Credential),
	)
}
