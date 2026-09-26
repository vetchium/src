# Verification

`make fmt` applies every formatter the repository owns. `make test` runs
everything below plus the CI stack and Playwright; it and `make clean` may be
run without asking. Use the narrow target in the inner loop and `make test`
before calling work done.

| Changed | Command |
| --- | --- |
| Any Go, in `backend/` or `typespec/` | `go test ./...` in the module, then `make test-go` (race, coverage) and `make test-go-static` (`gofmt`, `go vet`) |
| Go, before handoff | `make test-go-lint` (GolangCI-Lint), `make test-go-vuln` (`govulncheck`) |
| Queries, migrations, `sqlc.yaml` | `make sqlc` then `make sql-check` |
| `typespec/` (`.tsp`, `.ts`) | `make typespec-check`; add `make test-go` when the `.go` companion changed |
| `admin-ui/` | `make admin-ui-check` |
| `hub-ui/` | `make hub-ui-check` |
| `portal-ui/` | `make portal-ui-check`, then `make admin-ui-check hub-ui-check` |
| `playwright/` | `make playwright-check` (static), `make playwright-test` (full run) |
| Repository JSON | `make repository-json-check` |

Every npm package check also runs `npm audit --audit-level=high` on its locked
tree. `make sql-check` runs sqlc query vetting, verifies generated output, and
applies the pinned SQLFluff PostgreSQL linter for structural rules sqlc's parser
misses.

Rules:

- Require clean results with no new warnings. Never silence a failure by
  weakening a rule or excluding changed code.
- Commit generated output with the source change that caused it, and review the
  generated diff for unexpected method, parameter, nullability, or model changes:
  a generator can succeed and produce the wrong shape.
- Do not commit `typespec/tsp-output/`.
- Run `git diff --check` and read `git status` before committing so temporary
  files and unrelated edits stay out.

`make playwright-test` recreates the standalone `docker-compose-ci.json` stack
and waits on each API's `GET /healthz`. It and `make test` end with an API
contract coverage report built from Playwright request-fixture and browser
responses. Observed non-404 behavior missing from the generated OpenAPI
contract, undeclared statuses, and undeclared problem types fail the run; other
gaps are reported for follow-up, and 404s from intentionally unsupported paths
are listed separately as non-contract probes.
