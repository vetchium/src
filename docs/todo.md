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

- `admin-ui`, `hub-ui` and `orgs-ui` share their shell, auth, session,
  preferences, idempotency, API client and error presentation through
  `@vetchium/portal-ui`, but the auth pages are still written per portal:
  `LoginPage`, `TwoFactorPage`, `ReauthenticatePage`, `ForgotPasswordPage`,
  and `ResetPasswordPage` exist in all three, and `ProfilePage` in two. The
  Org copies were made deliberately for the first Org feature. Some
  differences are real (the Hub asks for a remembered session and a resident
  country; Org sign-in and password reset also take the Org domain; the admin
  portal needs neither), and some are drift. Decide which parts shared form
  components can own, then collapse the copies. `orgs-ui` also carries its own
  `isDefiniteRefusal` and `useDateTimeFormat` helpers that belong in
  `portal-ui` if the other portals adopt them.

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
  state. Follow the durable integration constraints in
  [`hub-subscriptions.md`](../agent-guides/hub-subscriptions.md#real-payment-integration).
- With the first integration, decide proration, failed-payment grace periods,
  and how billing agreements and unused paid time behave when a Hub user moves
  tenants. Also decide what happens when a tenant withdraws a plan and what
  happens to paid-feature content after a downgrade.

## Profile domain moderation

- Employer and educational-institution entries initially accept any
  syntactically valid domain. Add an admin-owned policy that can block a domain
  from new work or education entries and filter or remove existing entries
  across every tenant. Decide exact-domain versus registrable-domain matching,
  policy scope, propagation, appeals, audit evidence, and whether a later
  unblock restores removed content.
- Keep Hub profile rows keyed only by normalized domain. A future verified Org
  may provide display metadata for that domain, but must not become a foreign-key
  owner of Hub-user work or education data.

## Org follow-ups

Deferred from the first Org feature ([`org-signup.md`](org-signup.md),
section 11). Each needs its own specification first.

- Suspended-Org enforcement is only in orgs-ui and the absence of other Org
  routes today. The first Org route beyond account management must add the
  Org-suspended middleware described in
  [`orgs.md`](../agent-guides/orgs.md#suspended-orgs).
- The lockout invariant (an active Org keeps an active superadmin) has no
  writer to enforce it yet; the first Org user management statement must.
- Production DNS verification resolves through `1.1.1.1:53`
  (`deploy/*/config.json`). Confirm the resolver choice, or run a validating
  resolver per tenant, before production launch.
- Administrator management of the blocked signup-domain list and of Orgs,
  additional domains and domain transfer, Org plans beyond the seeded free
  tier, enterprise SSO, and Org migration between tenants.
- The tenant migration's down section fails because
  `hub_email_change_challenges` is never dropped before `hub_sessions`; the
  down path is not exercised by any test.

## Global Hub email uniqueness follow-ups

Deferred from [`global-uniqueness.md`](global-uniqueness.md), section 1.

- Hub login does not redirect to the account's home region. Deliberately not
  built: an unauthenticated "this email lives in region X" answer would be an
  account-enumeration oracle. Only a flow where the caller has proven mailbox
  control (a signup completion, an emailed notice) may reveal the home
  region.
- Hub account deletion does not exist yet. When it is built it must release
  the global account-email claim and every professional-email claim the user
  holds.
- Digest key rotation has no procedure yet, only the key id hook
  (`identitydigest.Key.ID()`, GU-KEY-004) that would let the coordinator
  detect a tenant still using the old key.
- Decommissioning a tenant must delete its `hub_professional_email_feed_cursors`
  row and any `hub_professional_email_supersessions` rows still addressed to
  it (GU-DIR-010); nothing does this yet, since no tenant decommissioning
  procedure exists.
- No `backend/handlers/mesh/directory_test.go` exists for any directory
  operation relayed through mesh-api, the eight Hub-email ones included; it
  is exercised only by `go build`/`go vet` (interface satisfaction) and by
  the Playwright API suite against the real CI stack.
