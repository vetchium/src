# T02 Federation: Add Prepare and Settle hooks to commands

## Requirements

PST-RPL-006, PST-RPL-008 (mechanism only; T18 registers the reply hooks)

## Guides

`agent-guides/federation.md` ("Durable cross-tenant commands"),
`agent-guides/go.md`, `agent-guides/database.md`, `agent-guides/posts.md`

## Exemplars

- `backend/internal/federation/commands/sender.go`: `Send`, `drive`,
  `abandon`, `Recover`, `stored`
- `backend/internal/federation/commands/commands.go`: `Registry.Register`
- `backend/internal/federation/commands/commands_integration_test.go`

## Steps

1. In `commands.go` add:
   ```go
   // PrepareFunc runs in the transaction that creates the pending operation.
   // A non-nil problem refuses the request: the transaction rolls back and
   // nothing is stored.
   type PrepareFunc func(ctx context.Context, tx pgx.Tx, operationID pgtype.UUID) (*problem.Details, error)

   // SettleFunc runs in the transaction that stores an operation's final
   // outcome, and in the abandon transaction (Outcome.State is then
   // StateUnavailable).
   type SettleFunc func(ctx context.Context, tx pgx.Tx, command Command, operationID pgtype.UUID, outcome Outcome) error
   ```
   Use the problem type the package already uses for `Rejected`.
2. Add `Request.Prepare PrepareFunc` (optional). `Send` calls it in the
   transaction that inserts the pending operation, only when it inserts a new
   operation. A replay of an existing operation never calls it.
3. When `Prepare` returns a problem, roll back and return
   `Outcome{State: StateFailed, Response: <that problem>}`. No operation and
   no idempotency row remain, so the same key may be sent again.
4. Add `Registry.RegisterSettle(kind federationspec.CommandKind, settle SettleFunc)`.
   Panic on an unknown kind or a second registration. Settle belongs to the
   kind, not the request, because `Recover` has no `Request`.
5. Call the kind's `SettleFunc` in the transaction that stores a definite
   outcome (succeeded or failed) in `Send` and in `Recover`, and in the
   `abandon` transaction with `StateUnavailable`. An in-process (local
   authority) command calls it in the same transaction as the handler.
6. A `SettleFunc` error rolls back that transaction. `Send` returns the error;
   `Recover` keeps the operation due for a later attempt.
7. Document both hooks in `agent-guides/federation.md` under "Durable
   cross-tenant commands" as two bullets. Keep it terse.

## Tests

In `backend/internal/federation/commands/commands_integration_test.go` (or
a new `hooks_integration_test.go` in the package), with a test kind:

- `Prepare` runs once for a new operation and not on a replay with the same
  key.
- `Prepare` problem: `Send` returns `StateFailed` with that problem; no row in
  `federation_operations`; a second `Send` with the same key runs `Prepare`
  again.
- `Settle` runs with `StateSucceeded` for a local authority success, with
  `StateFailed` for a rejection, and with `StateUnavailable` on abandon.
- `Settle` runs in `Recover` for a remote outcome (use the existing fake relay).
- A `Settle` error leaves the operation pending.
- Writes made by `Prepare` and `Settle` commit or roll back with their
  transaction.

## Checks

- `cd backend && go test ./internal/federation/...`
- `make test-go GOTESTFLAGS='-p 2'`, `make test-go-static`, `make test-go-lint`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Existing command kinds behave the same (all existing tests pass).
- Both hooks are tested for each transaction named in the steps.

## Carried over
