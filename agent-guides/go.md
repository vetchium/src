# Go Guide

This guide applies to hand-maintained Go files. It does not apply to generated
files such as `backend/internal/db/sqlc/*.go`.

## Files and packages

- Name Go files in lowercase snake_case. Preserve the `_test.go` suffix.
- Use short lowercase package directory names such as `auth`, `users`, and
  `hubsignupdomains`.
- Hyphens are allowed in `backend/cmd/<executable>/` and TypeSpec contract
  directories. Go files inside those directories still use snake_case names.
- Keep each package focused on one responsibility.

## Formatting and imports

- Run `gofmt` on every changed Go file.
- Group imports in this order: standard library, external modules by domain,
  then packages from the current module.
- Separate import groups with one blank line. Sort each group lexically.
- Keep `github.com/jackc/...`, `github.com/vetchium/...`, `golang.org/...`, and
  `backend/...` in separate groups.
- Add an import alias only when it prevents ambiguity or clarifies ownership.
- Keep hand-maintained lines at or below 80 characters when practical.
- Wrap related lines evenly. Do not wrap an expression that fits clearly on
  one line.

## Implementation

- Pass `context.Context` through database, logging, and downstream calls.
- Wrap errors with `%w` when callers need the original error identity.
- Use named string types and typed constants for closed string sets.
- Validate closed string values received from untrusted sources.
- Do not use deprecated APIs. Check the version pinned by the owning module.

## Tests

- Keep tests beside the package that owns the behavior.
- Make tests independent and safe to run in parallel.
- Give integration-test records unique identifiers. Remove records created by
  the test.

## Verification

- Run `go test ./...` in every changed Go module.
- Run `make test-go` for race-enabled tests and coverage.
- Run `make test-go-static` for `gofmt` and `go vet`.
- Run `make test-go-lint` for GolangCI-Lint.
- Run `make test-go-vuln` for `govulncheck`.
