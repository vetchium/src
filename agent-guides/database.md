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
- Include required audit writes in the same transaction as the state change.
  Do not use best-effort or fire-and-forget audit persistence.
- Treat affected-row counts and `pgx.ErrNoRows` as concurrency or state signals
  where appropriate. Do not hide them behind a second check that introduces a
  time-of-check/time-of-use race.

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
