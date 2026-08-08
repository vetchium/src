# Playwright Guide

This guide applies to API and UI tests under `playwright/`.

## Test layout

- Put API tests in `playwright/api/` and browser tests in `playwright/ui/`.
- Import all wire types from `vetchium-specs`; inspect the matching `.tsp` and
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

## Verification

Run the complete self-contained suite from the repository root:

```sh
make test
```

This performs clean npm installs and all server-independent checks first. It
then installs Chromium, recreates and waits for every service from the
standalone `docker-compose-ci.json`, and runs Playwright last. To run
Playwright directly after that environment is prepared, execute:

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
