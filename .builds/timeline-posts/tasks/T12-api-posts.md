# T12 Hub API: Serve timeline posts and profile cards

## Requirements

PST-GEN-001 to PST-GEN-004, PST-ID-001, PST-ID-002, PST-OWN-003, PST-OWN-004,
PST-POS-001 to PST-POS-011, PST-BLK-005 (profile Posts tab), PST-THR-006,
PST-THR-007, PST-RD-001, PST-RD-003, PST-RD-004

## Guides

`agent-guides/backend.md`, `agent-guides/go.md`, `agent-guides/database.md`,
`agent-guides/federation.md`, `agent-guides/hub-profile.md`,
`agent-guides/hub-subscriptions.md`, `agent-guides/posts.md`

## Exemplars

- `backend/handlers/hub/profile/alias_set.go` (plan gate and
  `hubproblem.PlanRequiredError(subscriptionspec.SilverTier)`)
- `backend/handlers/hub/profile/read.go`, `backend/handlers/mesh/profile.go`,
  `backend/internal/profileclient/client.go`
- `backend/handlers/hub/blocks/` from T06 (address resolution)
- `backend/internal/fanout` (T03), `backend/internal/postid` (T01)

## Steps

1. `backend/handlers/hub/posts/posts.go`: `Create`, `Edit`, `Remove`,
   `SetPolicies`, `List`, `Get`.
2. `Create`: mint the ID with `postid.New`. One transaction: lock the user,
   count posts in the last 24 hours (`>= 100` gives
   `hub-post-limit-reached`), insert with the Silver plan gate (0 rows gives
   `hub-plan-required` for `hub-silver-tier`), audit `hub.post.created` (no
   words). Return `201` with the `Post`.
3. `Edit`: own post only (else `hub-post-not-found`). Map the zero-row cause:
   not live → `hub-post-not-found`; window → `hub-post-edit-closed`;
   revision → `hub-post-conflict`; plan → `hub-plan-required`. Audit
   `hub.post.edited`.
4. `Remove`: own live post; audit `hub.post.removed`; `204`. (T18 adds
   cleanup; T25 adds `hub-post-unquoted`.)
5. `SetPolicies`: own post, live; audit `hub.post.policies-changed`.
6. `List` and `Get`: resolve `owner` as in T06. If the viewer muted the owner,
   `List` returns `muted: true` and no posts without a remote call. A local
   owner reads the database. A remote owner calls `/mesh/posts/list` or
   `/mesh/posts/get-many` through a new `backend/internal/postsclient`
   (structure like `profileclient`, deadline `fanout.DefaultDeadline`). A
   transport failure returns `hub-post-unavailable`. The owner card fields
   come from the owner's tenant in the same response.
7. Mesh handlers in `backend/handlers/mesh/posts.go`: relay and peer
   `list` and `get-many`, with viewer verification (PST-RD-003).
   `get-many` answers `not-homed` for an owner DID this tenant does not home.
8. `read-cards`: `backend/handlers/hub/profile/cards.go` groups handles by
   tenant (local first, then directory), reads remote tenants with
   `fanout.Do`, and lists failures as `unavailable`. Mesh relay and peer in
   `backend/handlers/mesh/profile.go`. The payload has only the card fields
   (PROF-FED-007).
9. Register all routes.

## Tests

- Unit tests for problem mapping in `backend/handlers/hub/posts/posts_test.go`.
- API tests come in T13.

## Checks

- `cd backend && go test ./handlers/... ./internal/postsclient/...`
- `make test-go GOTESTFLAGS='-p 2'`, `make test-go-static`, `make test-go-lint`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Every T10 operation is routed and returns only contract responses.

## Carried over
