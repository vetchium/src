package routes

import (
	"net/http"

	coordinatorhandler "backend/handlers/globalcoordinator"
	"backend/internal/apiserver"
	"backend/internal/globalcoordinator"
)

func RegisterGlobalCoordinatorRoutes(
	mux *http.ServeMux, s *globalcoordinator.Server,
) {
	mux.HandleFunc("GET /healthz", apiserver.HealthCheck)
	mux.HandleFunc(
		"POST /api/global-coordinator/generate-short-id",
		coordinatorhandler.GenerateShortID(s),
	)
}
