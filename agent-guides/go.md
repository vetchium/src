# Go Guide

This guide applies to every hand-maintained Go file in the repository. It does
not apply to generated Go output such as `backend/internal/db/sqlc/*.go`.

## Formatting and imports

- Name Go source files in lowercase snake_case. Preserve the conventional
  `_test.go` suffix. Directory names follow what the directory already answers
  to elsewhere, so hyphens stay in two cases: `backend/cmd/<name>/` matches its
  executable and container image name, and a directory under `typespec/` matches
  the contract path its `.tsp` file defines. A hyphenated contract directory
  still holds snake_case Go files, as `typespec/admin/hub-signup-domains/`
  does — the sibling check in `typespec/scripts/check-contract-files.mjs`
  expects that pairing.
- Run `gofmt` on every changed Go file.
- Group imports by domain. Put standard-library imports first, then
  non-standard modules grouped by module owner or domain in lexical order, and
  imports belonging to the current module last.
- Separate import groups with one blank line and sort imports lexically within
  each group. Do not combine `github.com/jackc/...`,
  `github.com/vetchium/...`, `golang.org/...`, or `backend/...` in one group.
  `backend/handlers/admin/login.go` is the repository example.
- Keep hand-maintained source lines at or below 80 characters where practical.
- When wrapping related lines, keep their widths reasonably balanced. Avoid a
  nearly full first line followed by a very short continuation.
- Do not split expressions or argument lists when the complete form fits
  comfortably within 80 columns.
- In structured log calls, keep every key and its value on the same physical
  line. Prefer one key/value pair per continuation line when a call wraps.

## Implementation practices

- Normalize every timestamp exposed by an API response to UTC before encoding
  it. A `time.Time` with a non-UTC location must call `UTC()` at the response
  boundary even when it represents the same instant.
- Represent closed string vocabularies, including wire enums and discriminator
  values, with a named string type and a typed constant for every allowed
  value. Use those constants when constructing or comparing values instead of
  repeating string literals. Do not widen a closed vocabulary field to
  `string`; validate values received from untrusted inputs because a named Go
  type alone does not enforce membership at runtime.
- Propagate request contexts through database, logging, and downstream calls.
- Preserve error identity with `%w` when adding context to returned errors.
- Avoid deprecated library APIs. Check the version pinned by the owning module
  and its documentation instead of copying examples for another version.
- Keep required slices non-nil when their JSON representation must be `[]`.
  Preserve `nil` only when the contract makes the value optional or nullable.

## Tests and verification

- Keep regression tests close to the package that owns the behavior.
- Make tests independent and safe to run in parallel. Integration tests must
  generate unique identifiers and clean up every record they create.
- Run `go test ./...` from every Go module affected by the change.
- Run `make test-go` from the repository root for all Go modules. This runs
  unit tests with both statement coverage and the race detector enabled.
- Run `make test-go-static` for formatting and `go vet`, `make test-go-lint`
  for the pinned GolangCI-Lint standard set, and `make test-go-vuln` for the
  official Go vulnerability scan.
- Run `make test` for the complete repository suite; it automatically prepares
  the standalone CI stack from `docker-compose-ci.json` and the Playwright
  Chromium browser.
