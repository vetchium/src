# Database

Applies to PostgreSQL access, `backend/internal/db/`, migrations, and seeds.

## Ownership

- Reach PostgreSQL only through sqlc queries; no ad hoc SQL in handlers or
  middleware (except a fixed connection probe).
- `backend/internal/db/queries/` is the source; `backend/internal/db/sqlc/` is
  generated and never edited, not even to wrap a line. `backend/sqlc.yaml`
  holds generator settings.
- Schema changes go in `db/migrations/` (tenant) or `db/global-migrations/`
  (coordinator).
- A down section drops everything its up section creates, dependents first;
  `make migration-check` applies, resets, and reapplies each set on a scratch
  database and fails on leftover objects.
- Scope a constraint to the owner of its rule; two portals with equal allowed
  values today get separate constraints.

## Queries

- Annotate `:one`, `:many`, `:exec`, or `:execrows`; query names become stable
  Go API names.
- Parameters only; never interpolate.
- Keep authorization, tenant, state, and expiry predicates in the query when
  correctness depends on an atomic decision.
- Select explicit columns.
- One read per operation (joins, CTEs, bulk parameters). Never query in a loop;
  use arrays, `ANY`, `unnest`, or joins.
- Lists use keyset pagination with a deterministic tie-breaker. `OFFSET` only
  for an explicitly bounded set, with the reason documented.
- Write predicates the intended index order can serve.

## Writes and transactions

- Instants are `timestamptz` with session time zone UTC. Plain `timestamp`
  only for a value that is deliberately not an instant.
- One logical operation is one statement where PostgreSQL can express it
  (CTEs, state predicates, `RETURNING`), not read-after-write.
- When several statements are unavoidable, run them in one transaction opened
  at the service boundary with `Queries.WithTx`; never commit part of an
  operation.
- Treat affected-row counts and `pgx.ErrNoRows` as state signals; never replace
  them with a preceding check.
- Sibling data-modifying CTEs run in no guaranteed order and do not see each
  other's rows. Never let two of them write the same key: to replace a set,
  delete only the rows that go and insert only the new ones
  (`ON CONFLICT DO NOTHING`), never delete-all and reinsert.
- A statement that waits on `FOR UPDATE` re-reads only the locked rows;
  whatever else it joins stays as it was before the wait. When a decision
  reads other tables, lock in one statement and read in the next.
- A `FOR UPDATE` CTE locks only if the plan reads it; a join whose other side
  finds no rows can skip it. Take a lock that must always happen in a plain
  `SELECT ... FOR UPDATE` of its own.
- A handler commits once per request. Two commits only where an external call
  must sit between them (an object-store upload, an identity-provider
  exchange), and then never hold a transaction open across that call.
- `go tool singlecommit` (a `tool` in `backend/go.mod`, run by
  `make test-go-static`) enforces this: it reports a handler under
  `backend/handlers/` that, directly or through what it calls, can commit
  more than once (a pool `Begin`, a write query through pool-bound Queries,
  or a call that commits). The only escape is a
  `//vetchium:multiple-commits <reason>` line in the doc comment of the
  function whose external call forces the split; never use it to save a
  transaction.
- Background work (workers, coordinator jobs) commits once per item; each
  item is one logical operation.

## Audit trail

- Every operation that commits an insert, update, or delete of application
  data writes at least one audit event in the same transaction, whatever the
  caller (portal API, mesh, worker). Exempt: the audit table itself,
  migrations, and the replay ledgers (`idempotency_ledger`,
  `global_command_ledger`).
- PostgreSQL enforces this. An insert into `audit_events`
  (`global_audit_events` in the coordinator) marks the transaction; the
  deferred `audit_required` constraint trigger on every other table refuses
  the commit when the application role changed rows without the mark. The
  table owner (migrations, `db-seed`, Playwright fixtures) is exempt; the
  replay ledgers are named in `vetchium.require_audit()`. Every table needs
  the trigger: the loop at the end of each `00001_init.sql` adds it to the
  tables above it, and `make migration-check` fails on a table without it.
- A write query that can run in a transaction of its own carries its audit
  CTE; one that only ever runs beside an audited statement may rely on it.
- Typed columns for everything used to authorize, filter, or paginate:
  - identity: event id, database-generated time, tenant;
  - subject: action name, entity type and id, useful parent ids;
  - actor: actor type and id (Hub user, Org user, admin, service, worker,
    cross-tenant caller); both authenticated and effective actor under
    delegation; the job and causing principal for automated work;
  - correlation: source, request id, idempotency or operation id, and an
    operator reason when the workflow collects one;
  - change: changed fields with before/after, or a summary with a payload
    schema version; a minimal snapshot for creates and deletes.
- Audit the logical operation, not each statement. A bulk change may use one
  event with the affected set or a bounded summary plus an operation id.
- Never store secrets, tokens, raw authorization headers, or whole request
  bodies or rows; minimize personal data (record that a sensitive field
  changed).
- Events are append-only. A replay adds no event for a change that did not
  happen again; a write that changed no rows claims no change.
- Test success (expected audit data) and failure of either write (both roll
  back), plus actor and correlation, sensitive-data exclusion, bulk, and
  replays where they apply.

## Generation

- sqlc is pinned to `v1.29.0` in the Makefile. Its output
  (`backend/internal/db/sqlc/`, `backend/internal/globaldb/sqlc/`) is
  git-ignored and never committed.
- `make sqlc` empties both directories and regenerates them; `make dev`,
  `make backend`, the seed targets, and every Go test target run it first.
  Run it after changing queries, migrations, or settings.
- Docker builds regenerate sqlc from source; `.dockerignore` keeps local
  output out of the build context.

## Avoid

- No `ALTER TABLE` or data-fixing `UPDATE` migrations: pre-production, data
  may be thrown away when the schema changes.
- No performance indexes until profiling; an index that enforces a constraint
  is fine.

## Bootstrap

On an empty volume, the PostgreSQL image runs `initdb`, then
`db/bootstrap/entrypoint.sh` (reads `APP_POSTGRES_PASSWORD_FILE`), then
`db/bootstrap/init.sql` as `POSTGRES_USER`: it creates the `vetchium_app`
login and `vetchium` schema, hardens schema access, and sets default
privileges. A separate container then runs the Goose migrations.

- Bootstrap never reruns; a `db/bootstrap/` change needs an explicit upgrade
  procedure for existing databases.
- Changing the password secret does not change the role; rotate both together.

## Development fixtures

- No production data in the repository; no fixtures in migrations.
- `db/db-seed/<tenant>.sql`: plain table content, re-runnable (restores
  fixture passwords, keeps granted access and state).
- `backend/cmd/dev-seed`: fixtures that must pass API validation,
  authorization, or audit. It signs in as an administrator `db-seed` created.
  `DEV_SEED_MODE` is `domains` (Hub signup allowlist; default), `hub-profiles`
  (`dev/hub-seed-profiles/`), or `orgs`. The last two need a fresh stack. Org
  TXT records do not survive a `dns-dev` restart.
- `deu` has no `manager@deu.example` on purpose: Playwright provokes the
  last-manager refusal there.
