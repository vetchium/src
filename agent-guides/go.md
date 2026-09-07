# Go

Applies to hand-maintained Go. Generated files such as
`backend/internal/db/sqlc/*.go` are excluded.

## Files and packages

- Go file names are lowercase snake_case, keeping the `_test.go` suffix. This
  holds inside `backend/cmd/<executable>/` and TypeSpec contract directories,
  whose directory names may contain hyphens.
- Package directories are short and lowercase: `auth`, `users`,
  `hubsignupdomains`. One responsibility per package.

## Formatting and imports

- Run `gofmt` on every changed file.
- Import groups, one blank line apart, each sorted lexically: standard library,
  external modules by domain, then the current module. Keep
  `github.com/jackc/...`, `github.com/vetchium/...`, `golang.org/...`, and
  `backend/...` in separate groups.
- Alias an import only to remove ambiguity or clarify ownership.
- Keep lines at or below 80 characters where practical. Wrap related lines
  evenly; do not wrap an expression that fits on one line.

## Implementation

- Thread `context.Context` through database, logging, and downstream calls.
- Wrap errors with `%w` when callers need the original error identity.
- Give closed string sets a named type and typed constants, and validate values
  arriving from untrusted sources against them.
- No deprecated APIs. Check the version pinned by the owning module.

## Tests

- Keep tests beside the package that owns the behavior.
- Tests are independent and parallel-safe.
- Integration-test records use unique identifiers and are removed by the test.

## Verification

See [`verification.md`](verification.md).
