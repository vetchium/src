# T03 Openings: Opening search in hub-api and across regions

## Requirements

OPN-SRCH-001, OPN-SRCH-002, OPN-SRCH-007 (routing), OPN-SRCH-008,
OPN-HUB-006.

## Guides

`agent-guides/backend.md`, `agent-guides/go.md`, `agent-guides/federation.md`,
`agent-guides/mesh-topology.md`, `agent-guides/openings.md`.

## Exemplars

`backend/handlers/hub/openings/read.go` (`List`, relay fallback,
`relayProblem`); `backend/handlers/mesh/openings.go`
(`RelayListOrgOpenings`, `PeerListOrgOpenings`, `writeOpeningPeerProblem`);
`backend/internal/publicopeningclient/client.go` (`NewRelay`, `NewPeer`,
`RelayList`, `PeerList`, `peerEndpoint`, `read`, response validation) and
`client_test.go`; wiring in `backend/cmd/hub-api/main.go`,
`backend/cmd/mesh-api/main.go`, `backend/internal/hub/server.go`,
`backend/internal/meshapi/server.go`; routes in
`backend/internal/routes/hub_routes.go` and `mesh_routes.go`.

## Steps

1. Client: new package `backend/internal/openingsearchclient` (or extend
   `publicopeningclient` if its `read` helper cannot be shared otherwise;
   do not copy it) with `RelaySearch(ctx, tenant, query)`,
   `RelaySuggestOrgs`, `PeerSearch(ctx, tenant, query)`, `PeerSuggestOrgs`.
   Peer URL `https://<tenant>.mesh.vetchium.com:8443/api/mesh/opening-search/<action>`
   with the TLS server name as `peerEndpoint` sets it. Validate responses
   (limit respected, every result's Org and summary well formed, at most 10
   suggestions). Outcomes carry either a result or a peer problem.
2. Hub handlers `backend/handlers/hub/openings/search.go`: `Search` and
   `SuggestOrgs` decode (with `Normalize` and `Validate`), then answer
   locally when `region` is absent or equals the hub-api tenant id, else
   call the relay with `{tenant_id: region, query}`. Map a relay transport
   error, and any problem other than `invalid-pagination-key` and
   `validation-failed`, to `hub-region-unavailable`. Set `Cache-Control:
   no-store`. Never log the keyword or query.
3. Mesh handlers `backend/handlers/mesh/opening_search.go`: relay handlers
   authenticate with `authenticateRelay`, refuse `tenant_id` equal to the
   own tenant by answering locally, and otherwise call the peer, mapping a
   transport error to `hub-region-unavailable`. Peer handlers require a
   caller tenant from `meshidentity.TenantFromContext` and answer only
   locally.
4. Wire `openingsearch.Reader` (with the tenant id) and the client into the
   hub-api and mesh-api servers, and register `POST
   /api/hub/search-openings` and `POST /api/hub/suggest-opening-orgs` behind
   `hubAuth`, the relay routes on the relay mux, and the peer routes on the
   peer mux only (federation.md).
5. Go tests: `client_test.go` for the new client (peer URL and server name,
   response validation, problem passthrough) and handler tests for region
   routing and problem mapping where the package already has handler tests.

## Tests

The client and handler Go tests in step 5; T04 covers routing end to end.

## Checks

`make test-go`, `make test-go-static`, `make test-go-lint`, then
`make test`.

## Acceptance

- `search-openings` and `suggest-opening-orgs` answer for the home region
  and, through the mesh, for another region, and fail closed with
  `hub-region-unavailable`.

## Carried over
