# Database

Applies to backend database access and the whole `backend/internal/db/` tree:
hand-maintained queries, generated sqlc code, and transaction boundaries.

## Ownership

- Backend code reaches PostgreSQL through the sqlc query interface, never ad hoc
  SQL in a handler or middleware. The one exception is a fixed minimal query that
  probes the raw connection.
- `backend/internal/db/queries/` is the source of truth for queries;
  `backend/internal/db/sqlc/` is generated and never hand-edited, not even to
  reformat or wrap a line. `backend/sqlc.yaml` owns generator settings.
- Schema changes originate in `db/migrations/`.
- Scope a constraint to the owner of the invariant. Do not give two portal
  capabilities one domain or check constraint because their allowed values are
  equal today; shared domains are for rules that must change in lockstep.

## Queries

- Annotate cardinality: `-- name: QueryName :one`, `:many`, `:exec`,
  `:execrows`. Names become exported Go API names; keep them descriptive and
  stable.
- Pass values as PostgreSQL parameters; never interpolate.
- Keep authorization, tenant, state, and expiry predicates inside the query
  whenever correctness depends on an atomic database decision.
- Select explicit columns so a schema addition cannot silently change generated
  models or scan behavior.
- Update affected queries when a migration changes generated types or method
  signatures.

## Reads

- Fetch everything one operation needs in a single read where reasonably
  expressible: joins, CTEs, correlated subqueries, bulk parameters.
- Never call the database in a loop. Use arrays, `ANY`, `unnest`, a join, or a
  CTE; fold dependent lookups into one query or one bulk lookup. No N+1.
- Unbounded list APIs use keyset pagination with a stable, deterministic
  tie-breaker. `OFFSET` only for an explicitly bounded dataset with the tradeoff
  documented.
- Keep query predicates compatible with the intended index order.

## Writes and transactions

- Store instants in `timestamptz`, with every connection's session timezone set
  to UTC. Never persist local wall-clock timestamps or offsets instead. Plain
  `timestamp` is only for a domain value that is deliberately not an instant.
- Perform all writes of one logical operation in one sqlc call whenever
  PostgreSQL can express it clearly: an atomic statement with CTEs, state
  predicates, and `RETURNING` (not a read-after-write).
- If more than one write call is unavoidable, run them in one transaction begun
  at the database or service boundary, bind queries with `Queries.WithTx`, and
  propagate errors so it rolls back. Never commit one part before attempting the
  next.
- Treat affected-row counts and `pgx.ErrNoRows` as concurrency or state signals;
  do not replace them with a preceding check (time-of-check/time-of-use race).

## Audit trail

Every logical operation that commits an `INSERT`, `UPDATE`, or `DELETE` of
persistent application data appends one or more durable audit events, whatever
its origin: admin, hub, orgs, or mesh API, a worker, or any internal process.

Exempt: the audit table's own inserts, schema migrations, and the idempotency
ledger (protocol state making a guarded operation replay-safe; that operation
audits the state change it commits).

Record in typed columns wherever authorization, filtering, or deterministic
keyset pagination needs the dimension, rather than leaving it in payload JSON:

- **Identity** — immutable event id, database-generated event time, tenant or
  cell.
- **Subject** — stable action name, primary entity type and id, and useful
  parent or related ids (the Org of an Opening, the Candidacy of a hiring-stage
  change).
- **Actor** — actor type and stable id, distinguishing Hub Users, Org Users,
  administrators, services, workers, and cross-tenant callers. Under delegation
  or impersonation keep both the authenticated and effective actor. For
  automated work, the service or job and, when known, the causing principal or
  operation.
- **Correlation** — source portal or service, request or trace id, idempotency
  or distributed-operation id when present, and an operator-supplied reason,
  ticket, or case id when the workflow collects one; never an invented
  placeholder.
- **Change** — changed field names with appropriate before/after values, or a
  domain summary with an explicit payload schema version. For creates and
  deletes, the minimum useful snapshot. Prefer stable domain vocabulary over UI
  labels.

Rules:

- Write the event in the same transaction as the state change; if either fails,
  roll back both. A log, metric, asynchronous job, or best-effort write is not a
  substitute.
- Audit the logical operation, not each SQL statement. A bulk operation may use
  one event naming the complete affected set, or a bounded summary plus a stable
  operation id; use per-entity events when history will be queried by entity.
  Always keep the ability to answer who changed an entity, what, when, from
  where, and as part of which operation.
- Never store passwords, authentication or recovery secrets, session tokens,
  private keys, raw authorization headers, or secret configuration. Minimize
  personal data and large free-form content: redact, hash, or record only that a
  sensitive field changed. Never copy whole request bodies or rows.
- Events are append-only; application paths never update or delete them. Any
  retention, export, redaction, or legally required erasure mechanism needs an
  explicit design keeping the remaining history intact and interpretable.
- A retry or idempotent replay adds no second event for a state change that did
  not happen again. A write affecting no rows claims no change; put required
  security-relevant rejected attempts in operational or security telemetry.
- Test both sides on every write path: success commits its expected audit data,
  and failure of either write rolls back both. Cover actor and correlation
  propagation, sensitive-data exclusion, bulk behavior, and idempotent retries
  where they apply.

## Generation

- The root Makefile pins sqlc to `v1.29.0`; never generate with an unpinned
  local version.
- After changing queries, migrations, or generator settings, run `make sqlc`
  from the repository root and commit the output with its source change.
- Committed sqlc output serves local builds and editor support only. Docker
  builds exclude it, remove residual output, and regenerate from migrations,
  queries, and `backend/sqlc.yaml`; never make a Docker build trust committed
  generated files.
- Overlong lines emitted by sqlc are acceptable; do not edit generated output to
  satisfy hand-maintained Go style.

## Avoid

- No `ALTER TABLE` or data-migration `UPDATE`s. The project is pre-production;
  when the schema changes, existing data may be thrown away if cleaner.
- No performance indexes; queries will be profiled before production. An index
  that is the only way to enforce a constraint is exempt.
