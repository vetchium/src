# Playwright Guide

This guide applies to API and UI tests under `playwright/`.

## Test layout

- Put API tests in `playwright/api/` and browser tests in `playwright/ui/`.
- Import all wire types from `typespec`; inspect the matching `.tsp` and
  `.ts` files before writing requests or response assertions.
- Give API clients a typed method for valid payloads. When validation behavior
  requires malformed input, expose a clearly named raw method accepting
  `unknown` or `Record<string, unknown>`.

## Parallel isolation

The runner uses `fullyParallel`. Assume every test can start at the same time,
on another worker, in any order, and more than once because of retries.

- Generate a UUID-backed identifier for every email, domain, tenant, user, and
  mutable resource created by a test. A timestamp, worker index, or fixed
  suffix is not unique enough by itself.
- Use `uniqueTestID` and `uniqueTestEmail` from `playwright/lib/test-id.ts` when
  a more domain-specific factory is not available.
- Each test owns its setup and cleanup. Delete everything it creates using an
  automatic fixture or `try`/`finally`, including partial setup left after a
  failed assertion.
- Do not make tests depend on mutations performed by another test. Do not
  share mutable resources through module globals, `beforeAll`, or ordered
  `describe` blocks.
- Do not use `serial`, `workers: 1`, project dependencies, or a global setup
  script to hide shared-state coupling. Redesign the data setup so it can run
  concurrently.
- Treat development seed records as read-only. Create dedicated records for
  mutation tests and never delete shared seed data.
- Scope mailbox, audit-log, and list queries to the test's unique identifiers;
  do not assert against the newest or only global record.
- Tests that change singleton configuration must restore it safely and use a
  namespace or tenant that no parallel test shares. If the product offers no
  isolation boundary, stop and raise the limitation instead of weakening the
  suite's parallel configuration.

## Reliable assertions

- Use Playwright's request fixture for API tests and the per-test browser
  context for UI tests.
- Prefer role, label, and test-id locators over CSS structure or visible text
  that changes with localization.
- Use retrying Playwright assertions or explicit event waits. Do not add fixed
  sleeps.
- Assert externally observable API or UI behavior. Direct database helpers are
  permitted for isolated setup and cleanup, not as a substitute for the
  behavior under test.

## Required change coverage

- Every new or changed API implementation must add or update tests under
  `playwright/api/` in the same change. Exercise every non-`5xx` response in
  the TypeSpec response union and assert its status, stable problem type,
  required headers, and response body. Shared table-driven contract tests count
  only when they explicitly enumerate the endpoint. Add a `5xx` integration
  case when the failure can be injected reliably without weakening isolation.
  A response owned by planned ingress middleware remains in the contract; note
  why it cannot yet be exercised and add its Playwright coverage when that
  middleware is present in the test topology.
- API tests must cover the successful state transition and important negative
  invariants, such as preserving an existing session or leaving persistent
  state unchanged after rejection. Handler unit tests alone are not sufficient
  because they do not verify routing, middleware, encoding, or the deployed
  database predicates.
- Every new or changed UI behavior must add or update tests under
  `playwright/ui/` in the same change. Cover the primary success path and every
  applicable validation, server-error, cancel/back, route-guard, session-state,
  and security-boundary path. Test both sides of time or permission boundaries
  with a safe margin so wall-clock scheduling cannot make the test flaky.
- Before declaring the implementation complete, review the contract and the
  changed UI as a response/behavior matrix and account for every row with a
  named test. Do not use the total test count as evidence of coverage.

## Verification

Run the complete self-contained suite from the repository root:

```sh
make test
```

This tears down any existing dev stack, then runs every independent unit —
Go tests, the admin-ui/TypeSpec/Playwright installs and lint/typecheck steps,
Chromium installation, and recreating and waiting for every service from the
standalone `docker-compose-ci.json` — in parallel, and runs Playwright last
once the CI stack reports healthy and Chromium is installed. Every API server
in the CI stack answers `GET /healthz` once it has finished starting, and
`docker compose ... --wait` blocks on that health check, so Playwright never
starts against a container that is merely running but not yet serving
requests. To run Playwright directly after that environment is prepared,
execute:

```sh
cd playwright
npm ci
npm run format:check
npm run typecheck
npm test
```

`make playwright-test` performs the same automatic environment setup and runs
only Playwright.

## CI Compose topology

- `docker-compose-ci.json` is a standalone duplicate of the complete local
  topology. Do not turn it into an overlay, include, extension, generated file,
  or template based on `docker-compose.json`.
- Keep service, network, secret, and health-check changes synchronized
  explicitly between the two Compose files.
- CI application configs live under `config/ci/`. They use the `ci`
  environment and intentionally short session and worker timings for
  integration tests.
