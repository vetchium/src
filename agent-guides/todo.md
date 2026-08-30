# Backlog

Deliberately deferred work. Each item names what is not done and what has to be
decided before it is.

## Hub signup

Hub self-signup, email ownership verification, tenant-local uniqueness,
idempotent completion, localized UI, audit events, and tenant isolation are
implemented. The remaining rollout and abuse-control work is tracked here.

### Signup policy

- Define tenant-local signup settings, including whether self-signup is open
  and which verification methods are enabled.

### Abuse and uniqueness controls

- Add rate limits for signup initiation, verification attempts, source
  addresses, and repeated email targets.
- Decide whether a low-cost CAPTCHA or proof-of-work challenge is needed after
  measuring abuse. Do not claim that a corporate domain proves a unique human.
- Add useful abuse signals without storing unnecessary personal data.

### Verification methods

- Design a verification-provider interface before adding country-specific
  identity checks.
- Configure providers per tenant. A provider enabled for one country or tenant
  must not appear or run in another tenant.
- Define consent, retention, redaction, audit, and deletion rules before
  collecting government identity data.
- Keep provider evidence separate from public profiles and ordinary product
  analytics.

### Operations and tests

- Add metrics for signup starts, verification delivery, completion, rejection,
  throttling, and provider failure without exposing email addresses in labels.
- Cover rate limiting once it is implemented.
- Add deployment and rollback notes before enabling self-signup for a tenant.
- Roll out behind tenant configuration and monitor one tenant before broader
  enablement.

## Go line width

- `go.md` asks for lines at or below 80 characters "where practical", and 283
  hand-maintained Go lines exceed it when a tab counts as four columns. Decide
  what the rule means and whether to enforce it. Thirty-two of those lines are
  gofmt-aligned struct tags that cannot be wrapped, so any enforcement needs an
  exemption for them; the rest are deep nesting inside idempotent closures and
  long generic type arguments.

## Portal page duplication

- `admin-ui` and `hub-ui` share their shell, auth, session, preferences,
  idempotency, API client and error presentation through
  `@vetchium/portal-ui`, but six auth pages are still written twice:
  `LoginPage`, `TwoFactorPage`, `ProfilePage`, `ReauthenticatePage`,
  `ForgotPasswordPage`, and `ResetPasswordPage`. They differ by 58 to 226 lines
  each. Some of that is real (the Hub asks for a remembered session and a
  resident country; the admin portal does not), and some is drift, which is how
  the Hub reset page came to swallow an incomplete link. Decide which of
  these pages a shared form component can own before `orgs-ui` copies them a
  third time.

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

- Playwright has one Hub UI spec against five admin specs, and two Hub API
  specs against eleven admin ones. Hub signup, login, two-factor, password
  reset and profile have no UI coverage. `typespec/hub/auth` and
  `typespec/hub/users` have no Go contract tests where their admin
  counterparts do.
