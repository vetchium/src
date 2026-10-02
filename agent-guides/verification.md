# Verification

Applies to choosing checks for a change.

Use the narrow target while working and `make test` before calling work done.
`make test` runs `make clean`, every check below, the CI stack, Playwright, and
the coverage reports. `make fmt` applies every formatter.

| Changed | Run |
| --- | --- |
| Go in `backend/` or `typespec/` | `go test ./...` in the module, `make test-go`, `make test-go-static`; before handoff `make test-go-lint` and `make test-go-vuln` |
| Queries, migrations, `sqlc.yaml` | `make sqlc`, then `make sql-check` |
| `typespec/` | `make typespec-check`; `make test-go` if a `.go` companion changed |
| `admin-ui/`, `hub-ui/`, `orgs-ui/` | `make admin-ui-check`, `make hub-ui-check`, `make orgs-ui-check` |
| `portal-ui/` | `make portal-ui-check` and all three portal checks (each portal type-checks it again) |
| `playwright/` | `make playwright-check`; `make playwright-test` for a full run |
| JSON outside npm packages | `make repository-json-check` |

- Results must be clean with no new warnings. Never weaken a rule or exclude
  changed code to pass.
- Commit generated output with its source, and read the generated diff for
  unexpected signatures, nullability, or models.
- Run `git diff --check` and read `git status` before committing.

## Playwright

- `make playwright-test` recreates the `docker-compose-ci.json` stack, waits on
  every API's `GET /healthz`, runs both projects, and prints contract coverage.
- Against a running stack (`make test-environment`): `npm run test:api` or
  `npm run test:ui` in `playwright/`, or `npx playwright test <files>`.
  Coverage is recorded only when `API_COVERAGE_DIR` is set; report rules are in
  [`playwright.md`](playwright.md).
