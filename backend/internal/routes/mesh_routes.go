package routes

import (
	"net/http"

	"backend/handlers/mesh"
	"backend/handlers/regions"
	"backend/internal/apiserver"
	"backend/internal/meshapi"
)

func RegisterMeshRoutes(mux *http.ServeMux, s *meshapi.Server) {
	mux.HandleFunc("GET /healthz", apiserver.HealthCheck)
	mux.HandleFunc("POST /mesh/list-signup-regions", regions.Handler(s.Runtime, s.Regions, s.RegionDirectory, s.Credential))
	mux.HandleFunc(
		"POST /mesh/directory/resolve-profile-slug",
		mesh.ResolveProfileSlug(s.Runtime, s.Directory, s.Credential),
	)
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
}

// RegisterMeshPeerRoutes is deliberately separate from the tenant-local relay.
// Federated operations are added here so they can only be reached through the
// private-CA mutual-TLS listener.
func RegisterMeshPeerRoutes(mux *http.ServeMux, s *meshapi.Server) {
	mux.HandleFunc("GET /healthz", apiserver.HealthCheck)
	mux.HandleFunc("POST /api/mesh/profile/read", mesh.PeerReadProfile(s))
}
