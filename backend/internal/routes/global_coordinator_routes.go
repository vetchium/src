package routes

import (
	"net/http"

	"backend/handlers/directory"
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
		regions.GlobalHandler(s.Runtime, s.Regions),
	)
	mux.HandleFunc(
		"POST /api/global-coordinator/directory/resolve-profile-slug",
		directory.ResolveProfileSlug(s.Runtime, s.Directory),
	)
	mux.HandleFunc(
		"POST /api/global-coordinator/directory/reserve-hub-principal",
		directory.ReserveHubPrincipal(s.Runtime, s.Directory),
	)
	mux.HandleFunc(
		"POST /api/global-coordinator/directory/activate-hub-principal",
		directory.ActivateHubPrincipal(s.Runtime, s.Directory),
	)
	mux.HandleFunc(
		"POST /api/global-coordinator/directory/set-hub-alias",
		directory.SetHubAlias(s.Runtime, s.Directory),
	)
	mux.HandleFunc(
		"POST /api/global-coordinator/directory/resolve-hub-account-email",
		directory.ResolveHubAccountEmail(s.Runtime, s.Directory),
	)
	mux.HandleFunc(
		"POST /api/global-coordinator/directory/reserve-hub-account-email-change",
		directory.ReserveHubAccountEmailChange(s.Runtime, s.Directory),
	)
	mux.HandleFunc(
		"POST /api/global-coordinator/directory/finalize-hub-account-email-change",
		directory.FinalizeHubAccountEmailChange(s.Runtime, s.Directory),
	)
	mux.HandleFunc(
		"POST /api/global-coordinator/directory/abandon-hub-account-email-change",
		directory.AbandonHubAccountEmailChange(s.Runtime, s.Directory),
	)
	mux.HandleFunc(
		"POST /api/global-coordinator/directory/resolve-org-domain",
		directory.ResolveOrgDomain(s.Runtime, s.Directory),
	)
	mux.HandleFunc(
		"POST /api/global-coordinator/directory/reserve-org-principal",
		directory.ReserveOrgPrincipal(s.Runtime, s.Directory),
	)
	mux.HandleFunc(
		"POST /api/global-coordinator/directory/activate-org-principal",
		directory.ActivateOrgPrincipal(s.Runtime, s.Directory),
	)
	mux.HandleFunc(
		"POST /api/global-coordinator/directory/release-org-domain",
		directory.ReleaseOrgDomain(s.Runtime, s.Directory),
	)
	mux.HandleFunc(
		"POST /api/global-coordinator/directory/claim-org-domain",
		directory.ClaimOrgDomain(s.Runtime, s.Directory),
	)
}
