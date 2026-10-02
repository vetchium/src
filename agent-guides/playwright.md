# Playwright

Applies to `playwright/`: API tests in `api/`, browser tests in `ui/`.

## Writing tests

- Import wire types from `typespec`; read the `.tsp` and `.ts` before writing
  requests or assertions.
- API clients get a typed method for valid payloads; malformed input goes
  through a clearly named raw method taking `unknown`.
- Use the `request` and `page` fixtures of the `test` exported by
  `lib/admin-fixtures.ts`; only they record API coverage.
- Locate by role, label, or test id, not CSS structure or translated text.
- Retrying assertions or explicit waits only; never a fixed sleep.
- Assert observable API or UI behavior. Database helpers are for setup and
  cleanup only.

## Isolation

The suite is `fullyParallel` against one shared stack, with a capped worker
count. Any test may run at any moment, on any worker, repeatedly.

- Give every created email, domain, user, and resource a UUID-backed id
  (`uniqueTestID`, `uniqueTestEmail` in `lib/test-id.ts`, or a domain
  factory).
- Each test creates and deletes its own data through a fixture or
  `try`/`finally`, including partial setup after a failure.
- No shared mutable state: no module globals, `beforeAll`, ordered `describe`,
  `serial`, `workers: 1`, project dependencies, or global setup. Change the
  worker cap only with evidence from a clean full run.
- Seed data is read-only. CI loads `db-seed` but not `dev-seed`; never depend
  on `dev-seed` fixtures.
- Tenant-wide admin invariants run only in `ISOLATED_TENANT` (`deu`); never
  create administrators there.
- Scope mailbox, audit, and list queries to the test's own ids. An address can
  receive several messages: search for the expected one, never trust the
  newest.
- Fault-injection triggers on shared tables take `AUDIT_FAULT_LOCK`
  (`lib/admin-db.ts`) in the same transaction; parallel DDL deadlocks without
  it.
- A test changing singleton configuration restores it and uses a tenant or
  namespace no other test shares; if none exists, raise it.

## Hosts and regions

- UI tests open `HUB_PORTAL` and `ORGS_PORTAL`; API tests call
  `apiOrigin(tenant)` (`lib/portals.ts`). Admin stays at
  `admin-ui.<region>.localhost`, the config `baseURL` (`PLAYWRIGHT_BASE_URL`
  overrides it).
- A test signing in through a portal explicitly chooses its region on the page.
  `rememberRegion` sets preferences only for flows that use preselection.
- Read emailed links with `emailedLinkToken` (checks `region=`) and open them as
  emailed.

## Required coverage

- A new or changed API updates `api/` in the same change: every non-`5xx`
  response in the contract's union, asserting status, problem type, required
  headers, and body; `5xx` where it can be injected safely. A table-driven test
  counts only if it names the endpoint. Responses owned by planned ingress
  middleware stay in the contract with a note.
- Cover the success transition and negative invariants (an existing session
  kept, state unchanged after a rejection). Handler unit tests do not cover
  routing, middleware, encoding, or database predicates.
- A new or changed UI behavior updates `ui/`: success plus every validation,
  server error, cancel or back, route guard, session state, and security
  boundary. Test both sides of a time or permission boundary with a margin.
- Before calling it done, map every contract response and UI behavior to a
  named test; a test count is not coverage.

## Coverage report

Commands are in [`verification.md`](verification.md).

- Fails on any response the contract does not declare: an unknown operation
  (any status, `404` included), an undeclared status or problem type, or a
  problem response without a type. Missing coverage is listed, not failed.
- `429` and `500` are excluded. Exempt a declared variant only via
  `PLAYWRIGHT_UNTESTABLE_VARIANTS` in `scripts/api-coverage-report.ts`.

## CI stack

- `docker-compose-ci.json` is a standalone copy of the local topology, never
  an overlay, include, or generated file. Sync services, networks, secrets, and
  health checks by hand.
- CI configs live in `config/ci/` (`ci` environment, short timings).
