# Backend Go Agent Guidance

These instructions apply to Go API-server and worker code under `backend/`.
The more specific `internal/db/AGENTS.md` overrides this file for database
access, queries, and generated code.

## Architecture and ownership

- `cmd/` contains the six executable entry points. Keep startup, shutdown, and
  dependency wiring there; put reusable behavior in packages.
- `handlers/` owns portal and mesh HTTP handlers.
- `internal/apiserver/` owns shared HTTP response and logging behavior.
- `internal/middleware/` owns cross-cutting request behavior.
- `internal/db/queries/` contains hand-maintained sqlc queries. Generated Go
  database access lives in `internal/db/sqlc/`.
- Import API request, response, problem, and domain types from the adjacent
  `typespec` module instead of duplicating wire structs in handlers.

## Go style

- Run `gofmt` on every changed Go file.
- Group imports by domain, following `handlers/admin/login.go` as the example:
  standard-library imports first, non-standard modules grouped by module owner
  or domain in lexical order, and local `backend/...` imports last. Separate
  each group with one blank line and sort imports lexically within each group.
  Do not combine `github.com/jackc/...`, `github.com/vetchium/...`,
  `golang.org/...`, or `backend/...` in one group.
- Keep hand-maintained source lines at or below 80 characters where practical.
- When wrapping related lines, keep their widths reasonably balanced; avoid a
  nearly full first line followed by a very short continuation.
- In structured log calls, keep each key and its value on the same physical
  line. Prefer one key/value pair per continuation line when a call wraps.
- Propagate request contexts through database, logging, and downstream calls.
- Preserve error identity with `%w` when adding context to returned errors.
- Keep handlers small: decode, normalize, validate, call dependencies, and
  encode a typed response through shared server behavior.
- Never log credentials, session tokens, database passwords, or other secrets.

## Verification

From the repository root, use:

```sh
gofmt -w <changed-go-files>
(cd backend && go test ./...)
```

Run `make test` when a backend change also touches the `typespec` module.
