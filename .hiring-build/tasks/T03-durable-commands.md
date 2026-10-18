# T03 Durable commands between tenants

Use a strong model for this task: later tasks depend on it.

Requirements: `federation.md` Authority and Durable cross-tenant commands;
HP-GEN-009; HP-APP-001 (transport); MKT-GEN-005; MKT-DAT-001.

Guides: `federation.md`, `mesh-topology.md`, `backend.md`, `database.md`,
`typespec.md`, `go.md`, `playwright.md`.

Exemplars: the alias change, which already runs the operation ledger against
the global directory: `backend/handlers/hub/profile/alias_set.go`,
`backend/handlers/hub/operations/status.go`,
`backend/internal/workers/complete_hub_alias_changes.go`, and
`backend/internal/db/queries/federation.sql` (`federation_operations`,
`federation_command_ledger`). Mesh relay and peer routes:
`backend/internal/routes/mesh_routes.go`, `backend/handlers/mesh/openings.go`,
`backend/internal/publicopeningclient/client.go` (relay and peer clients).

## Steps

1. One generic package (for example `backend/internal/federation/commands`)
   that an API process uses to send a command: it commits the idempotency
   row and a pending `federation_operations` row before any network call,
   resolves the authority tenant from the authoritative principal (Hub user
   or Org DID) through the directory, executes in process when the authority
   is the local tenant, and otherwise posts through the local mesh relay to
   the authority tenant's peer endpoint. Never hold a transaction across a
   directory or mesh call.
2. Authority side: one peer route (for example
   `POST /api/mesh/commands/execute`) and an in-process entry that look up a
   handler by command kind. The handler receives a transaction and returns
   a typed result; the command ledger row, business mutation, audit, and
   outbox events commit together. Same command id with another digest is a
   protocol error; same digest replays the stored result.
3. Outcomes: definite success or deterministic `4xx` resolves the operation;
   unknown outcome after sending returns `202` with `PendingOperation`;
   routing or connection failure before sending returns a retryable
   `503`/`504`.
4. Orgs side: add `Vetchium.Orgs.Operations.PendingOperation` and
   `/api/orgs/operations/status` mirroring the Hub shape (MKT-GEN-005).
5. A `workers` recovery job re-drives due pending operations of every kind
   with backoff, as `complete_hub_alias_changes.go` does for aliases.
6. Register no product command kinds yet; T07 adds the first.

## Tests

Go integration tests with a command kind registered only in the test: local
and remote execution, replay with the same and a different digest, unknown
outcome to `202` then recovery, authority unreachable before sending.
Playwright: the peer route refuses callers without mesh credentials
(`playwright/api/mesh.spec.ts`); Orgs operation status authorizes the owner
only.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make test-go-lint`, `make playwright-check`, changed
specs against `make test-environment`.

## Acceptance

Any later task sends a cross-tenant write by registering a kind and a
handler, with no per-feature reliability code.
