package routes

import (
	"net/http"

	"backend/handlers/mesh"
	"backend/internal/apiserver"
	"backend/internal/meshapi"
)

func RegisterMeshRoutes(mux *http.ServeMux, s *meshapi.Server) {
	mux.HandleFunc("GET /healthz", apiserver.HealthCheck)
	mux.HandleFunc(
		"POST /mesh/directory/reserve-hub-principal",
		mesh.ReserveHubPrincipal(s.Runtime, s.Directory, s.Credential),
	)
	mux.HandleFunc(
		"POST /mesh/directory/activate-hub-principal",
		mesh.ActivateHubPrincipal(s.Runtime, s.Directory, s.Credential),
	)
	mux.HandleFunc(
		"POST /mesh/directory/set-hub-alias",
		mesh.SetHubAlias(s.Runtime, s.Directory, s.Credential),
	)
	mux.HandleFunc(
		"POST /mesh/directory/resolve-hub-account-email",
		mesh.ResolveHubAccountEmail(s.Runtime, s.Directory, s.Credential),
	)
	mux.HandleFunc(
		"POST /mesh/directory/reserve-hub-account-email-change",
		mesh.ReserveHubAccountEmailChange(s.Runtime, s.Directory, s.Credential),
	)
	mux.HandleFunc(
		"POST /mesh/directory/finalize-hub-account-email-change",
		mesh.FinalizeHubAccountEmailChange(s.Runtime, s.Directory, s.Credential),
	)
	mux.HandleFunc(
		"POST /mesh/directory/abandon-hub-account-email-change",
		mesh.AbandonHubAccountEmailChange(s.Runtime, s.Directory, s.Credential),
	)
	mux.HandleFunc(
		"POST /mesh/directory/resolve-org-domain",
		mesh.ResolveOrgDomain(s.Runtime, s.Directory, s.Credential),
	)
	mux.HandleFunc(
		"POST /mesh/directory/reserve-org-principal",
		mesh.ReserveOrgPrincipal(s.Runtime, s.Directory, s.Credential),
	)
	mux.HandleFunc(
		"POST /mesh/directory/activate-org-principal",
		mesh.ActivateOrgPrincipal(s.Runtime, s.Directory, s.Credential),
	)
	mux.HandleFunc(
		"POST /mesh/directory/release-org-domain",
		mesh.ReleaseOrgDomain(s.Runtime, s.Directory, s.Credential),
	)
	mux.HandleFunc(
		"POST /mesh/directory/claim-org-domain",
		mesh.ClaimOrgDomain(s.Runtime, s.Directory, s.Credential),
	)
	mux.HandleFunc("POST /mesh/profile/read", mesh.RelayReadProfile(s))
	mux.HandleFunc("POST /mesh/org-openings/list", mesh.RelayListOrgOpenings(s))
	mux.HandleFunc("POST /mesh/org-openings/get", mesh.RelayGetOrgOpening(s))
	mux.HandleFunc("POST /mesh/hub-applications/get", mesh.RelayGetHubApplication(s))
	mux.HandleFunc("POST /mesh/commands/execute", mesh.RelayExecuteCommand(s))
	mux.HandleFunc("POST /mesh/events/deliver", mesh.RelayDeliverEvent(s))
}

// RegisterMeshPeerRoutes is deliberately separate from the tenant-local relay.
// Federated operations are added here so they can only be reached through the
// private-CA mutual-TLS listener.
func RegisterMeshPeerRoutes(mux *http.ServeMux, s *meshapi.Server) {
	mux.HandleFunc("GET /healthz", apiserver.HealthCheck)
	mux.HandleFunc("POST /api/mesh/profile/read", mesh.PeerReadProfile(s))
	mux.HandleFunc("POST /api/mesh/org-openings/list", mesh.PeerListOrgOpenings(s))
	mux.HandleFunc("POST /api/mesh/org-openings/get", mesh.PeerGetOrgOpening(s))
	mux.HandleFunc("POST /api/mesh/hub-applications/get", mesh.PeerGetHubApplication(s))
	mux.HandleFunc("POST /api/mesh/commands/execute", mesh.PeerExecuteCommand(s))
	mux.HandleFunc("POST /api/mesh/events/deliver", mesh.PeerDeliverEvent(s))
}
