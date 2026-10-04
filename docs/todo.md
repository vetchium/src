# Deferred work

Each item: what is not done, and what must be decided first.

## Code quality

- Go line width: `go.md` asks for 80 columns where practical; nothing enforces
  it. Decide the rule and exemptions for `gofmt`-controlled lines.
- Portal page duplication: `LoginPage`, `TwoFactorPage`, `ReauthenticatePage`,
  `ForgotPasswordPage`, and `ResetPasswordPage` exist in all three portals,
  `ProfilePage` in two. Decide what shared form components own, then collapse
  them. `orgs-ui`'s `isDefiniteRefusal` and `useDateTimeFormat` belong in
  `portal-ui` if other portals adopt them.
- Log levels: one level per outcome is too coarse (a rejected login and a
  malformed body both log 4xx at info), malformed JSON is logged twice, and no
  setting enables debug. Add a process-wide level first; then decide what the
  level keys off (route, problem type, or status) and where it is configured.
  Keep one record per handler exit.
- The tenant migration's down section fails: `hub_email_change_challenges` is
  not dropped before `hub_sessions`. No test runs the down path.
- `make sqlc` and `make sql-check` leave generated files whose query source
  was deleted; `internal/db/sqlc/org_billing_jobs.sql.go` still queries the
  dropped invoice and notice tables. Delete it and make the check fail on
  orphans.
- Org subscription and company code drifts from its neighbours: unwrapped Go
  calls in `handlers/orgs/subscriptions`, one-space indentation in
  `org_subscriptions.sql` and `org_company.sql`, the interval built twice in
  `SetSubscriptionPlan`. `SetCompanyName` borrows `LockOrgForBilling` and
  `GetOrgSubscription` (which counts seats) only to read `org_state`.
- `orgs-ui` `PlanOptions`: the `mcp` comparison row falls through to the
  ticket-support entitlement, and a label ternary is a no-op.
  `users.state.disabledManual` is unused in every locale.
- `org_users_disabled_consistent` tests `disabled_reason IS NOT NULL` before
  `= 'manual'`; with one reason left, decide whether the column stays.

## Test coverage

- Admin concurrent password resets: `api/admin-password.spec.ts` receives 401
  instead of 204 when completing the token selected by `emailCredential` after
  two successful concurrent requests. Determine whether token selection or
  reset ordering is wrong before changing the assertion.
- Hub browser paths: signup completion success, TOTP sign-in and management,
  reauthentication success, and the profile fields and failures not yet
  covered.
- Go contract tests for `typespec/hub/auth` and `typespec/hub/users`.
- `backend/handlers/mesh` directory relays have no Go tests; only the
  Playwright API suite exercises them.

## Hub

- Payments: plans run on simulated payments everywhere, production included.
  Integrate real processors before charging (see `hub-subscriptions.md`).
  Decide proration, failed-payment grace, billing on a tenant move, plan
  withdrawal, and paid content after a downgrade.
- Account deletion does not exist. It must release the global account-email
  claim.
- Identity digest key rotation has no procedure, only the key id check.
- Many accounts verifying the same professional address or domain is an abuse
  signal; add admin detection and blocking.
- Profile domain moderation: employer and institution entries accept any valid
  domain. Add an admin policy to block domains and remove existing entries in
  every region. Decide exact vs registrable-domain matching, scope,
  propagation, appeals, audit, and whether unblocking restores content.

- Not built for profiles: Org access to professional-email domain evidence
  (needs its own authorization, privacy, and contract design); Org display
  metadata or links for profile employer and institution domains; picture
  crops, resizing, responsive variants, and CDN; constructed, historical, or
  script- and region-specific language choices.
- Profile write endpoints still lack malformed-JSON and idempotency-conflict
  replay coverage in the contract report.

## Orgs

- Production DNS verification uses `1.1.1.1:53`. Confirm it, or run a
  validating resolver per region, before launch.
- Org check-now is meant to be rate-limited at ingress, but no Traefik rate
  limit exists for it (or anything else).
- Org password, TOTP, and login contracts declare no
  `x-vetchium-security-effects`, unlike their admin and Hub counterparts.
  Decide whether every credential operation must declare them.
- Not built: admin management of blocked signup domains and of Orgs; extra
  domains, primary-domain change, and domain transfer; Org terms acceptance;
  Org profile metadata beyond name and logo (description, legal entity); remembered
  Org sessions; Org migration between regions; openings and every other hiring
  feature.
- Org payments: launch is blocked on a real provider integration. The provider
  should own renewals, retries, payment methods, and invoices; Vetchium keeps
  entitlements and a webhook-fed projection, never card data. Decide provider
  (per region if needed), proration, when paid entitlements start, tax,
  refunds, billing contacts, and nonpayment consequences.
- Openings enforcement: only the quota constants and the counting rule exist
  (`internal/orgs/entitlements`). The publish statement must apply it under the
  Org lock.
- Org user management at scale: groups, custom roles beyond the catalog, SCIM
  provisioning (the expected next step for large Google sign-in Orgs), invite
  links, domain auto-join, and an Org-facing audit log viewer.
- Single sign-on beyond Google: SAML and other OIDC providers (the credential
  table and `internal/oidc` are provider-neutral), just-in-time provisioning,
  and enforcing SSO-only sign-in for an Org.
- MCP support for Gold Orgs is shown as "Coming soon" in the plan comparison
  and has no contract value until it is built.
- Gold ticket-based support: give Gold Org users a way to raise and track
  support tickets, gated on the plan's ticket-support entitlement
  (`org-subscriptions.md`). Decide between building tickets into the portals
  and integrating a ticketing SaaS, and settle who may open tickets, data
  residency, and response targets.

## Global portals

- `vetchium.com/org/<domain>` is a reserved placeholder. Not built: Org
  pages, public openings, anonymous profile viewing, search indexing (needs
  server-side rendering in the home region, never at the static host's edge).
- The Vite dev servers cannot call regional APIs (CORS allows only the
  `*.vetchium.localhost` portal origins). Use `make dev` or Tilt, or decide a
  dev-server origin.
- Production TLS issuance and the static-host deploy have not been exercised.
