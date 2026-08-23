# Database Guide

This guide applies to backend database access and the complete
`backend/internal/db/` tree, including hand-maintained queries, generated sqlc
code, and transaction boundaries.

## Ownership and boundaries

- Use the sqlc query interface from backend code instead of embedding ad hoc
  SQL in handlers or middleware. A minimal fixed query is allowed for a
  connectivity probe whose purpose is testing the raw database connection.
- `backend/internal/db/queries/` is the source of truth for application
  queries.
- `backend/internal/db/sqlc/` is generated output. Do not hand-edit files there,
  including for cosmetic formatting or line wrapping.
- `backend/sqlc.yaml` owns generator settings.
- PostgreSQL schema changes originate in `db/migrations/`.

## Query conventions

- Use sqlc annotations such as `-- name: QueryName :one`, `:many`, `:exec`, or
  `:execrows` according to the expected cardinality.
- Keep query names descriptive and stable because they become exported Go API
  names.
- Use PostgreSQL parameters rather than interpolating values into SQL.
- Keep authorization, tenant, state, and expiry predicates in the query when
  correctness depends on an atomic database decision.
- Use explicit selected and returned columns so schema additions do not
  silently change generated models or scan behavior.
- Update affected queries when a migration changes generated types or method
  signatures.

## Reads and query efficiency

- Retrieve everything needed from the same database in one read call whenever
  reasonably expressible. Prefer joins, CTEs, correlated subqueries, and bulk
  parameters over dependent query sequences.
- Never issue a database call inside a loop. Use arrays, `ANY`, `unnest`, a
  join, or a CTE for bulk work.
- If one query identifies rows needed by another, fold the work into one query
  or pass the identifiers to one bulk lookup. Do not create N+1 query patterns.
- Use keyset pagination with a stable, deterministic tie-breaker for unbounded
  list APIs. Do not use `OFFSET` pagination unless the dataset is explicitly
  bounded and the tradeoff is documented.
- Add indexes and constraints from demonstrated access and integrity needs;
  keep query predicates compatible with the intended index order.

## Writes and transactions

- Store timestamp instants in `timestamptz` columns and keep every database
  connection's session timezone set to UTC. Do not persist local wall-clock
  timestamps or timezone offsets as substitutes for an instant. Use plain
  `timestamp` only when the domain value is intentionally not an instant.
- Perform all writes for one logical operation in one sqlc call whenever
  PostgreSQL can express the operation clearly. Prefer an atomic statement with
  CTEs, state predicates, and `RETURNING`.
- Use `RETURNING` for values produced by a write instead of a separate
  read-after-write query.
- If an operation requires more than one write call, run every call in one
  transaction. Begin it at the database or service boundary, bind generated
  queries with `Queries.WithTx`, and propagate errors so the transaction rolls
  back.
- Writes touching multiple rows or tables must be one atomic SQL statement or
  share one transaction. Never commit one part before attempting the next.
- Treat affected-row counts and `pgx.ErrNoRows` as concurrency or state signals
  where appropriate. Do not hide them behind a second check that introduces a
  time-of-check/time-of-use race.

## Audit trail for every write

- Every logical operation that commits an `INSERT`, `UPDATE`, or `DELETE` of
  persistent application data must also append one or more durable audit events.
  This applies regardless of whether the write originates in an admin, hub,
  org, or mesh API, a worker, or another internal process. The audit table's own
  inserts and schema migrations are not recursively audited.
- Write the audit event in the same database transaction as the state change.
  If either the state change or its audit write fails, roll back both. An
  application log, metric, asynchronous job, or best-effort write is not a
  substitute for this persistent audit trail.
- Audit a logical operation rather than mechanically emitting one event per SQL
  statement. A bulk operation may use one event when it identifies the complete
  affected set or records a bounded summary plus a stable operation identifier;
  use per-entity events when the history will be queried by entity. Never lose
  the ability to answer who changed a particular entity, what changed, when,
  from where, and as part of which operation.
- Give each event an immutable event identifier and database-generated event
  time. Record the tenant or cell, stable action name, primary entity type and
  identifier, and any useful parent or related identifiers, such as an Org for
  an Opening or a Candidacy for a hiring-stage change. Keep dimensions needed
  for authorization, filtering, and deterministic keyset pagination in typed
  columns rather than making future history APIs extract them from payload
  JSON.
- Record the initiating actor type and stable actor identifier. Distinguish Hub
  Users, Org Users, administrators, services, workers, and cross-tenant callers.
  Preserve both the authenticated actor and the effective actor when delegation
  or impersonation exists. For automated work, record the service or job and,
  when available, the principal or operation that caused it.
- Carry correlation context from the operation boundary: source portal or
  service, request or trace identifier, and idempotency or distributed-operation
  identifier when present. Record an operator-supplied reason, support ticket,
  or case identifier when the workflow collects one; do not invent placeholder
  values when it does not.
- Describe the committed change with a safe structured payload: changed field
  names and appropriate before/after values, or a domain-specific summary that
  can evolve through an explicit payload schema version. For creates and
  deletes, capture the minimum useful snapshot needed to understand the event.
  Prefer stable domain vocabulary over UI labels so future history APIs can
  render events consistently.
- Never store passwords, authentication or recovery secrets, session tokens,
  private keys, raw authorization headers, or secret configuration in audit
  data. Minimize personal data and large free-form content; redact, hash, or
  record only that a sensitive field changed when its value is unnecessary.
  Audit storage is not an excuse to duplicate entire request bodies or rows.
- Audit events are append-only. Application paths must not update or delete
  them. Any retention, export, redaction, or legally required erasure mechanism
  needs an explicit design that preserves the integrity and interpretability of
  the remaining history.
- A successful retry or idempotent replay must not create a second audit event
  for a state change that did not occur again. A write that affects no rows and
  commits no application-state change does not claim that a change occurred;
  separately record security-relevant rejected attempts in operational or
  security telemetry when required.
- Tests for every write path must assert both sides of the invariant: a
  successful state change commits its expected audit data, and failure of either
  write rolls back the state change and audit event together. Cover actor and
  correlation propagation, sensitive-data exclusion, bulk behavior, and
  idempotent retries where they apply.

## Generation

- The root Makefile pins sqlc to version `v1.29.0`; do not generate with an
  unpinned local version.
- After changing queries, migrations, or generator settings, run `make sqlc`
  from the repository root and commit generated output with its source change.
- Committed sqlc output exists for local builds and editor support only.
- Docker builds must exclude committed sqlc output, remove residual output, and
  regenerate from migrations, queries, and `backend/sqlc.yaml` before
  compiling. Never change a Docker build to trust committed generated files.
- Overlong lines emitted by sqlc are acceptable. Do not modify generated output
  solely to satisfy hand-maintained Go style.

## Verification

Run from the repository root:

```sh
make sqlc
make sqlc-verify
make sql-check
(cd backend && go test ./...)
```

`make sql-check` runs sqlc's query vetting, verifies generated output, and uses
the pinned SQLFluff PostgreSQL linter for structural rules that complement
sqlc's parser.

Review generated diffs for unexpected method, parameter, nullability, or model
changes.

## Things to Avoid
- Do not add any ALTER TABLE, UPDATE statements. This entire project is still
  heavily under development. It is not yet in Production. There is no need to
  migrate any existing data when the schema is changed. All the database data
  can be assumed to be thrown away if there is a cleaner solution.
- Do not add any database indexes for performance. We will complete the entire
  project and will profile the queries and the required indexes before we go to
  production. Do not optimize prematurely. If there are indexes needed for some
  constraint enforcement, and there is no way to achieve them without creating
  indexes, those cases are exempted.
