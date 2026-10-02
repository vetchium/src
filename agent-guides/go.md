# Go

Applies to hand-written Go; generated `sqlc/` files are excluded.

- File names: lowercase `snake_case.go`, also in hyphenated directories.
  Package directories: short, lowercase, one purpose (`auth`,
  `hubsignupdomains`).
- `gofmt` every changed file. Import groups, blank-line separated and sorted:
  standard library; external modules by domain (`github.com/jackc/...`,
  `github.com/vetchium/...`, `golang.org/...` each its own group); then
  `backend/...`.
- Alias an import only to resolve ambiguity.
- Aim for 80-column lines (not enforced); never wrap an expression that fits.
- Pass `context.Context` to database, logging, and downstream calls.
- Wrap errors with `%w` when callers need the original.
- A closed string set gets a named type with typed constants; validate
  untrusted values against it.
- No deprecated APIs for the pinned module versions.
- Tests live beside the owning package, run in parallel safely, use unique
  identifiers, and remove what they create.
