# Go

Applies to hand-maintained Go; generated files such as
`backend/internal/db/sqlc/*.go` are excluded.

## Files and packages

- File names are lowercase snake_case, keeping `_test.go`, including inside
  `backend/cmd/<executable>/` and TypeSpec contract directories whose directory
  names may contain hyphens.
- Package directories are short and lowercase (`auth`, `users`,
  `hubsignupdomains`), one responsibility each.

## Formatting and imports

- `gofmt` every changed file.
- Import groups, one blank line apart, each sorted lexically: standard library,
  external modules by domain, then the current module. Keep
  `github.com/jackc/...`, `github.com/vetchium/...`, `golang.org/...`, and
  `backend/...` in separate groups.
- Alias an import only to remove ambiguity or clarify ownership.
- Lines at most 80 characters where practical. Wrap related lines evenly; never
  wrap an expression that fits on one line.

## Implementation

- Thread `context.Context` through database, logging, and downstream calls.
- Wrap errors with `%w` when callers need the original error identity.
- Closed string sets get a named type and typed constants; validate untrusted
  values against them.
- No deprecated APIs; check the version pinned by the owning module.

## Tests

- Keep tests beside the package that owns the behavior.
- Tests are independent and parallel-safe.
- Integration-test records use unique identifiers and are removed by the test.
