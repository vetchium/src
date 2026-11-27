# T06 Hub API: Serve blocks and mutes

## Requirements

PST-BLK-001, PST-BLK-004, PST-BLK-006, PST-BLK-007, PST-BLK-008,
PST-RPL-004 (mesh check side), PST-RD-003, PST-GEN-004

## Guides

`agent-guides/backend.md`, `agent-guides/go.md`, `agent-guides/database.md`,
`agent-guides/federation.md`, `agent-guides/hub-profile.md` ("Federated reads
and commands"), `agent-guides/posts.md`

## Exemplars

- `backend/handlers/hub/profile/read.go` (resolve an address locally, then
  through the directory; remote read)
- `backend/handlers/mesh/profile.go` (`RelayReadProfile`, `PeerReadProfile`,
  viewer verification)
- `backend/internal/profileclient/client.go`
- `backend/internal/routes/hub_routes.go`, `mesh_routes.go`

## Steps

1. Create `backend/handlers/hub/blocks/blocks.go` with `Block`, `Unblock`,
   `ListBlocks`, `State`, `Mute`, `Unmute`, `ListMutes`.
2. Resolve `user` to (DID, permanent handle, tenant ID) as the profile read
   does. Not found: `hub-profile-not-found`. Directory or mesh failure:
   `hub-profile-unavailable`. The caller's own DID: `validation-failed` on
   field `user`.
3. Block and mute: one transaction inserts the row and writes the audit event
   `hub.user.blocked` or `hub.user.muted` only when a row was inserted.
   Unblock and unmute: delete and audit `hub.user.unblocked` or
   `hub.user.unmuted` only when a row was deleted. All return `204`.
4. Lists use the T05 queries with `limit + 1` for the next key. `State`
   returns `blocked` and `muted` for the resolved DID. A remote address that
   cannot be resolved returns `hub-profile-unavailable`.
5. Create `backend/handlers/mesh/blocks.go`: `RelayCheckBlock` and
   `PeerCheckBlock`, following `profile.go`. The serving tenant verifies that
   the calling tenant homes the viewer (the blocked user), then answers from
   `HubUserBlockExists`.
6. Create `backend/internal/blocksclient/client.go` (copy the structure of
   `profileclient`) with `Check(ctx, blockerDID, blockedDID, viewerHandle)`.
   T19 uses it.
7. Register the Hub routes behind `hubAuth` and the mesh routes in
   `mesh_routes.go`.

## Tests

- Handler unit tests in `backend/handlers/hub/blocks/blocks_test.go` for
  request validation and self-block.
- `backend/handlers/mesh/blocks_test.go` for viewer verification failure.
- API behavior is tested in T07.

## Checks

- `cd backend && go test ./handlers/... ./internal/blocksclient/...`
- `make test-go GOTESTFLAGS='-p 2'`, `make test-go-static`, `make test-go-lint`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Every T04 operation is routed and returns the contract's responses.

## Carried over
