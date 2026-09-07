# Playwright

Applies to the API and UI tests under `playwright/`. Read
[`typescript.md`](typescript.md) as well.

## Layout

- API tests in `playwright/api/`, browser tests in `playwright/ui/`.
- Import every wire type from `typespec`, and read the matching `.tsp` and
  `.ts` files before writing requests or response assertions.
- Give each API client a typed method for valid payloads. Where validation
  behavior needs malformed input, expose a clearly named raw method taking
  `unknown` or `Record<string, unknown>`.

## Parallel isolation

The runner is `fullyParallel`: assume every test can start at the same moment,
on another worker, in any order, and more than once through retries. The worker
count is capped because the suite shares one resource-heavy local container
stack, and host CPU count does not measure its database and container capacity.
Keep the cap parallel; change it only with evidence from a clean full-suite
run, never to hide a test-isolation defect.

- Generate a UUID-backed identifier for every email, domain, tenant, user, and
  mutable resource a test creates. A timestamp, worker index, or fixed suffix
  is not unique enough. Use `uniqueTestID` and `uniqueTestEmail` from
  `playwright/lib/test-id.ts` when no domain-specific factory exists.
- Each test owns its setup and cleanup, and deletes everything it created
  through an automatic fixture or `try`/`finally`, including partial setup left
  by a failed assertion.
- No test depends on another test's mutations. No sharing mutable resources
  through module globals, `beforeAll`, or ordered `describe` blocks.
- Never use `serial`, `workers: 1`, project dependencies, or a global setup
  script to paper over shared-state coupling. Redesign the data setup instead.
- Development seed records are read-only. Create dedicated records for mutation
  tests and never delete shared seed data.
- Scope mailbox, audit-log, and list queries to the test's unique identifiers.
  Never assert against the newest or the only global record.
- A test changing singleton configuration restores it safely and uses a
  namespace or tenant no parallel test shares. If the product offers no such
  boundary, raise the limitation instead of weakening the parallel
  configuration.

## Assertions

- Use the request fixture for API tests and the per-test browser context for UI
  tests.
- Prefer role, label, and test-id locators over CSS structure or visible text
  that changes with locale.
- Use retrying assertions or explicit event waits. Never a fixed sleep.
- Assert externally observable API or UI behavior. Direct database helpers are
  for isolated setup and cleanup only, never as a stand-in for the behavior
  under test.

## Required coverage

- Every new or changed API implementation updates `playwright/api/` in the same
  change. Exercise every non-`5xx` response in the TypeSpec response union and
  assert status, stable problem type, required headers, and body. A shared
  table-driven test counts only when it enumerates the endpoint explicitly. Add
  a `5xx` case when the failure can be injected reliably without weakening
  isolation. A response owned by planned ingress middleware stays in the
  contract: note why it cannot be exercised yet and add coverage when that
  middleware is in the test topology.
- API tests cover the successful state transition and the important negative
  invariants, such as preserving an existing session or leaving persistent
  state unchanged after a rejection. Handler unit tests are not enough: they do
  not verify routing, middleware, encoding, or the deployed database
  predicates.
- Every new or changed UI behavior updates `playwright/ui/` in the same change:
  the primary success path plus every applicable validation, server-error,
  cancel/back, route-guard, session-state, and security-boundary path. Test
  both sides of a time or permission boundary with a safe margin so wall-clock
  scheduling cannot make it flaky.
- Before declaring the work complete, walk the contract and the changed UI as a
  response/behavior matrix and account for every row with a named test. Total
  test count is not evidence of coverage.

## CI Compose topology

- `docker-compose-ci.json` is a standalone duplicate of the full local
  topology. Never turn it into an overlay, include, extension, generated file,
  or template derived from `docker-compose.json`.
- Synchronize service, network, secret, and health-check changes between the
  two files explicitly.
- CI application configs live under `config/ci/` and use the `ci` environment
  with intentionally short session and worker timings.

## Verification

See [`verification.md`](verification.md).
