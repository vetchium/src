# Backlog

Deliberately deferred work. Each item names what is not done and what has to be
decided before it is.

## Go line width

- `agent-guides/go.md` asks for lines at or below 80 characters "where
  practical", but the repository does not enforce that rule and
  hand-maintained Go still exceeds it. Decide what "where practical" means and
  whether to enforce it. Any enforcement needs exemptions for lines that
  `gofmt` controls, including aligned struct tags.

## Portal page duplication

- `admin-ui` and `hub-ui` share their shell, auth, session, preferences,
  idempotency, API client and error presentation through
  `@vetchium/portal-ui`, but six auth pages are still written twice:
  `LoginPage`, `TwoFactorPage`, `ProfilePage`, `ReauthenticatePage`,
  `ForgotPasswordPage`, and `ResetPasswordPage`. Some differences are real
  (the Hub asks for a remembered session and a resident country; the admin
  portal does not), and some are drift. Decide which parts shared form
  components can own before `orgs-ui` copies them a third time.

## Mesh tenant authentication

- `backend/handlers/mesh/sync.go` accepts any caller. It is the only
  unauthenticated write surface in the tree and the only TODO marker left in
  hand-written source. The endpoint is not routed to the public internet — the
  mesh network is internal — but it must authenticate the calling tenant
  before it carries anything.

## Per-route log levels

- Every handler exit is recorded once. `Runtime.Problem` logs 4xx at info and
  5xx at warning. `Runtime.JSON` and `Runtime.Empty` log success at info.
- One level for every route is too coarse. A rejected login and a malformed
  request body are both 4xx, and they do not deserve the same level.
- Malformed JSON is logged twice. `InvalidJSON` writes a warning carrying the
  decode error, then `Problem` records the response.
- `service.Logger` sets no `slog` level, so the handler default of info
  applies. Debug records are discarded in every environment and no setting
  enables them.
- Add a process-wide level control first. Nothing can move to debug while
  debug is dropped.
- Decide what the level keys off: the route, the problem type, or the status.
- Decide where it is configured. The per-tenant JSON file and an environment
  variable both reach every service.
- Keep one record per exit. A per-route level must lower a record, never
  remove the exit trace.

## Hub portal test coverage

- Hub authentication and subscriptions have broad API coverage, and the Hub
  foundation, signup-region, and plan flows have browser coverage. Complete
  the remaining browser paths: successful signup completion, TOTP sign-in and
  account management, reauthentication success, forgot/reset password, and
  the profile fields and failures not exercised by the preferred-job-country
  test.
- Add Go contract tests for `typespec/hub/auth` and `typespec/hub/users`, where
  the admin counterparts and Hub subscriptions already have companion tests.

## Hub subscription payments

- Hub plans are implemented with simulated payments in every environment,
  including production. Integrate real payment processors before charging for
  paid plans; processor choice and credentials must be tenant-specific, the
  server must own price mapping, and verified webhooks must drive subscription
  state. The requirements and provider constraints are in
  [subscriptions-plans.md](subscriptions-plans.md#payment-integration-requirements-in-future).
- With the first integration, decide proration, failed-payment grace periods,
  and how billing agreements and unused paid time behave when a Hub user moves
  tenants. Also decide what happens when a tenant withdraws a plan and what
  happens to paid-feature content after a downgrade.
