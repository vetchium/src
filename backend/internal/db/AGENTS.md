# Backend Database Agent Guidance

These instructions apply to the complete `backend/internal/db/` tree,
including the database connection package, hand-maintained queries under
`queries/`, and generated sqlc code under `sqlc/`.

## Ownership and boundaries

- Use the sqlc query interface from backend code instead of embedding ad hoc
  SQL in handlers or middleware.
- `queries/` is the source of truth for application queries.
- `sqlc/` is generated output. Do not hand-edit files there, including for
  cosmetic formatting or line wrapping.
- `backend/sqlc.yaml` owns generator settings.
- PostgreSQL schema changes originate in the repository's `db/migrations/`
  tree. Follow any instructions scoped to that tree when changing migrations.

## Query conventions

- Use sqlc annotations such as `-- name: QueryName :one`, `:many`, `:exec`, or
  `:execrows` according to the expected cardinality.
- Keep query names descriptive and stable because they become exported Go API
  names.
- Use PostgreSQL parameters rather than interpolating values into SQL.
- Keep authorization, tenant, state, and expiry predicates in the query when
  correctness depends on an atomic database decision.
- Update affected queries when a migration changes generated types or method
  signatures.

## Generation

- The root Makefile pins sqlc to version `v1.29.0`; do not generate with an
  unpinned local version.
- After changing queries, migrations, or generator settings, run `make sqlc`
  from the repository root and commit generated output with its source change.
- Committed sqlc output exists for local builds and editor support only.
- Docker builds must exclude committed sqlc output, remove any residual output,
  and regenerate from migrations, queries, and `backend/sqlc.yaml` before
  compiling. Never change a Docker build to trust committed generated files.
- Overlong lines emitted by sqlc are acceptable; do not modify generated output
  solely to satisfy the hand-maintained Go 80-column guideline.

## Verification

Run these commands from the repository root:

```sh
make sqlc
make sqlc-verify
(cd backend && go test ./...)
```

Review generated diffs for unexpected method, parameter, nullability, or model
changes.

