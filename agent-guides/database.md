# Database

Applies to backend database access and the whole `backend/internal/db/` tree:
hand-maintained queries, generated sqlc code, and transaction boundaries.

## Ownership

- Backend code reaches PostgreSQL through the sqlc query interface, never ad
  hoc SQL in a handler or middleware. The one exception is a fixed minimal
  query whose purpose is probing the raw connection.
- `backend/internal/db/queries/` is the source of truth for application
  queries. `backend/internal/db/sqlc/` is generated: never hand-edit it, not
  even to reformat or wrap a line. `backend/sqlc.yaml` owns generator settings.
- Schema changes originate in `db/migrations/`.
- Scope a constraint to the owner of the invariant. Do not give two portal
  capabilities one domain or check constraint because their allowed values are
  equal today. Shared domains are for rules that must change in lockstep.

## Queries

- Annotate cardinality: `-- name: QueryName :one`, `:many`, `:exec`,
  `:execrows`.
- Query names become exported Go API names; keep them descriptive and stable.
- Pass values as PostgreSQL parameters; never interpolate them.
- Keep authorization, tenant, state, and expiry predicates inside the query
  whenever correctness depends on an atomic database decision.
- Select and return explicit columns so a schema addition cannot silently
  change generated models or scan behavior.
- Update affected queries when a migration changes generated types or method
  signatures.

## Reads

- Fetch everything one operation needs in a single read whenever it is
  reasonably expressible: joins, CTEs, correlated subqueries, bulk parameters.
- Never call the database inside a loop. Use arrays, `ANY`, `unnest`, a join,
  or a CTE.
- When one query finds rows another query needs, fold them into one query or
  one bulk lookup. No N+1.
- Unbounded list APIs use keyset pagination with a stable, deterministic
  tie-breaker. `OFFSET` only for an explicitly bounded dataset with the
  tradeoff documented.
- Keep query predicates compatible with the intended index order.

## Writes and transactions

- Store instants in `timestamptz` with every connection's session timezone set
  to UTC. Never persist local wall-clock timestamps or offsets as a substitute.
  Plain `timestamp` is only for a domain value that is deliberately not an
  instant.
- Perform all writes for one logical operation in one sqlc call whenever
  PostgreSQL can express it clearly: an atomic statement with CTEs, state
  predicates, and `RETURNING`. Use `RETURNING` instead of a read-after-write.
- If more than one write call is unavoidable, run them in one transaction
  begun at the database or service boundary, bind queries with
  `Queries.WithTx`, and propagate errors so it rolls back. Never commit one
  part before attempting the next.
- Treat affected-row counts and `pgx.ErrNoRows` as concurrency or state
  signals. Do not replace them with a preceding check, which creates a
  time-of-check/time-of-use race.

## Audit trail

Every logical operation that commits an `INSERT`, `UPDATE`, or `DELETE` of
persistent application data appends one or more durable audit events, whatever
its origin: admin, hub, orgs, or mesh API, a worker, or any internal process.

Exempt: the audit table's own inserts, schema migrations, and the idempotency
ledger, whose rows are protocol state making a guarded operation replay-safe —
that operation audits the state change it commits.

Record, in typed columns wherever authorization, filtering, or deterministic
keyset pagination needs the dimension, rather than leaving it for a future
history API to dig out of payload JSON:

- **Identity** — immutable event id, database-generated event time, tenant or
  cell.
- **Subject** — stable action name, primary entity type and id, and useful
  parent or related ids such as the Org of an Opening or the Candidacy of a
  hiring-stage change.
- **Actor** — initiating actor type and stable id, distinguishing Hub Users,
  Org Users, administrators, services, workers, and cross-tenant callers. Under
  delegation or impersonation keep both the authenticated and the effective
  actor. For automated work, the service or job and, when known, the principal
  or operation that caused it.
- **Correlation** — source portal or service, request or trace id, idempotency
  or distributed-operation id when present, and an operator-supplied reason,
  ticket, or case id when the workflow collects one. Never an invented
  placeholder.
- **Change** — changed field names with appropriate before/after values, or a
  domain-specific summary carrying an explicit payload schema version. For
  creates and deletes, the minimum useful snapshot. Prefer stable domain
  vocabulary over UI labels.

Rules:

- Write the event in the same transaction as the state change. If either fails,
  roll back both. A log, metric, asynchronous job, or best-effort write is not
  a substitute.
- Audit the logical operation, not each SQL statement. A bulk operation may use
  one event when it names the complete affected set, or a bounded summary plus
  a stable operation id; use per-entity events when history will be queried by
  entity. Never lose the ability to answer who changed a given entity, what
  changed, when, from where, and as part of which operation.
- Never store passwords, authentication or recovery secrets, session tokens,
  private keys, raw authorization headers, or secret configuration. Minimize
  personal data and large free-form content: redact, hash, or record only that
  a sensitive field changed. Audit storage is not a place to copy whole request
  bodies or rows.
- Events are append-only. Application paths never update or delete them. Any
  retention, export, redaction, or legally required erasure mechanism needs an
  explicit design that keeps the remaining history intact and interpretable.
- A retry or idempotent replay must not add a second event for a state change
  that did not happen again. A write affecting no rows claims no change; put
  security-relevant rejected attempts in operational or security telemetry
  instead when they are required.
- Test both sides on every write path: a successful change commits its expected
  audit data, and failure of either write rolls back both. Cover actor and
  correlation propagation, sensitive-data exclusion, bulk behavior, and
  idempotent retries where they apply.

## Generation

- The root Makefile pins sqlc to `v1.29.0`. Never generate with an unpinned
  local version.
- After changing queries, migrations, or generator settings, run `make sqlc`
  from the repository root and commit the output with its source change.
- Committed sqlc output exists for local builds and editor support only. Docker
  builds exclude it, remove residual output, and regenerate from migrations,
  queries, and `backend/sqlc.yaml` before compiling. Never make a Docker build
  trust committed generated files.
- Overlong lines emitted by sqlc are acceptable. Do not edit generated output
  to satisfy hand-maintained Go style.

## Avoid

- No `ALTER TABLE` or data-migration `UPDATE`s. The project is pre-production;
  when the schema changes, existing data may be thrown away if that is the
  cleaner solution.
- No performance indexes. Queries will be profiled before production. An index
  that is the only way to enforce a constraint is exempt.

## Verification

See [`verification.md`](verification.md). Read the generated diff for
unexpected method, parameter, nullability, or model changes.
