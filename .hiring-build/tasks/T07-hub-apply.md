# T07 Hub apply, withdraw, and the applications projection

Requirements: HP-APP-001 to HP-APP-004, HP-APP-006, HP-GEN-004, HP-GEN-005,
HP-GEN-009, HP-HUB-001, HP-HUB-002, the withdraw rows of the States table,
`hub-application-not-found`, `hub-org-unavailable`. HP-APP-007 and the
"Referred by" choice are T24; the request has no referral field yet.

Guides: `hiring-pipeline.md`, `federation.md`, `openings.md` (Hub display),
`typespec.md`, `backend.md`, `database.md`, `playwright.md`.

Exemplars: commit `9d95b8d` (Hub and mesh reads of an Opening, local and
remote, `hub-org-unavailable`); `backend/handlers/hub/profile/alias_set.go`
(`202` `PendingOperation`); T03 and T04.

## Steps

1. Hub API `apply-to-opening` (Org domain, opening number, cover note ≤5,000
   code points, `Idempotency-Key`): builds the snapshot from the caller's
   own profile view fields (no picture, no professional-email evidence) and
   sends `hub-apply` through T03. `withdraw-application` sends a
   `hub-withdraw` command handled at the Org tenant.
2. The Org tenant enqueues a projection event (T04) on every application
   change, carrying only HP-GEN-004 fields and the derived Hub status
   (HP-HUB-001); the Hub tenant keeps one projection row per application
   with a version watermark.
3. Hub reads: `list-my-applications` from the projection (keyset ≤50, newest
   activity first); `get-my-application` reads live from the Org tenant over
   the mesh with a deadline (`hub-org-unavailable`), returning only Hub
   status, pending actions, and Opening identity.
4. Org suspension stops new applications; existing ones still show.

## Tests

Playwright API: apply to a local and a remote Org, the `202` path and
recovery (see `playwright/api/orgs-unavailable.spec.ts` for an unavailable
tenant), duplicate under concurrency, withdraw from each allowed state,
not-accepting states, suspended Org, list order and pagination, detail when
the Org tenant is down, and that no stage name, routing, result, or
feedback appears in any Hub or mesh response to the Hub.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, new specs against
`make test-environment`.

## Acceptance

A Hub user in any region applies and withdraws; both sides see consistent
state.
