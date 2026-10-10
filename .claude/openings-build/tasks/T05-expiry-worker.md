# T05 Opening expiry worker

Requirements: OPN-LIFE-009, OPN-LIFE-010, OPN-GEN-004.

Guides: `go.md`, `backend.md`, `database.md`, `playwright.md`,
`verification.md`.

Exemplars: `backend/internal/workers/workers.go` (job registration and
timers), `warn_hub_subscription_expiry.go` and its test (selecting due rows
in bounded batches), `prune_admin_sessions.go`; worker timer settings in
`config/`, `config/ci/`, and `deploy/*/config.json` (follow how existing
timers are configured, and keep every checked-in config valid).

## Steps

1. Query `ExpireOrgOpenings`: in bounded batches (100) of
   `published`/`paused` Openings with `expires_at <= now()`, ordered by
   `expires_at`, one statement per Opening or per batch that sets `expired`,
   `ended_at`, bumps `version`, deletes any working copy, marks a pending
   request `cancelled`, writes `expired` and `cancelled` history with no
   actor, and audits with a worker actor. Guard on state so a concurrent
   close wins cleanly.
2. Register the job in `workers` with a timer (production a few minutes,
   CI about a second) following existing timer configuration.
3. Go tests for the job loop; an integration or Playwright test that sets
   `first_published_at`/`expires_at` into the past with `orgSQL`, waits
   with a retrying assertion, and checks state, cancelled request, history,
   and audit. Expiry runs for a suspended Org too.

## Checks

`make sqlc`, `make sql-check`, `make test-go`, `make test-go-static`,
`make repository-json-check` if configs changed, then `make test`.
