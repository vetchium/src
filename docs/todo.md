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
- `orgs-ui` `PlanOptions`: the `mcp` comparison row falls through to the
  ticket-support entitlement, and a label ternary is a no-op.
  `users.state.disabledManual` is unused in every locale.
- Federation tables without a production caller: `federation_outbox`,
  `federation_inbox`, and `federation_command_ledger` are written only by
  `internal/db` integration tests, and `PruneExpiredFederationOperations` and
  `RetryFederationOutboxEvent` have no caller. Their writes carry no audit
  event. Decide whether cross-tenant commands will use them; then wire them
  with audit CTEs or delete them.
- `public_org_openings.sql` hides the Org logo with a hard-coded
  `org_plan_oid <> 'org-free-tier'`, a second authority beside
  `subscriptions.AllowsLogo`. Rely on the downgrade removing the logo, or pass
  the entitlement in from Go.

## Test coverage

- Hub browser paths: signup completion success, TOTP sign-in and management,
  reauthentication success, and the profile fields and failures not yet
  covered.
- Go contract tests for `typespec/hub/auth` and `typespec/hub/users`.
- `backend/handlers/mesh` directory relays have no Go tests; only the
  Playwright API suite exercises them.
- The database integration tests (`TENANT_DATABASE_URL`,
  `GLOBAL_DATABASE_URL`) run in no make target. Decide where they run (a
  scratch database like `make migration-check`, or the CI stack).

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
  domains, primary-domain change, and domain transfer; remembered Org
  sessions; Org migration between regions.
- The Org terms page (`orgs-ui` `terms.*` strings, every locale) holds
  placeholder text. Replace it and `OrgTermsVersion` before launch; decide
  whether existing Orgs must accept a later version, and how.
- Optional Org profile fields, edited after signup and shown on the Hub:
  description, industry, size band, founding year, and office cities (cities
  only, never street addresses). Prompt from the Orgs home page; never ask at
  signup.
- Legal entity name, registered address, and tax ID: collect only when Org
  payments need them, through the payment provider's checkout, private and
  never shown on the Hub. A home-office address is personal data.
- Org payments: launch is blocked on a real provider integration. The provider
  should own renewals, retries, payment methods, and invoices; Vetchium keeps
  entitlements and a webhook-fed projection, never card data. Decide provider
  (per region if needed), proration, when paid entitlements start, tax,
  refunds, billing contacts, and nonpayment consequences.
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

## Openings

- Not specified: applications and the rest of hiring; watchers and email
  notifications for requests and decisions (decide recipients, batching, and
  opt-out); tags (seeded opening-tag OIDs) and cost centers; multi-step or
  per-Org approval chains; extending expiry without a new quota slot.
- Cross-Org discovery: searching Openings of every Org, filtered by preferred
  job countries. Decide between a mesh fan-out and a rebuildable per-tenant
  projection fed by the outbox, and how ranking and pagination work across
  tenants. Also decide entry points to `/org/<domain>`, such as profile
  employer domains.
- Moderation: Admin takedown of an Opening. Decide whether a takedown is a
  state, the notice to the Org, appeal, audit, and which tenant's admins
  act.
- Pay transparency: some jurisdictions (the EU Pay Transparency Directive,
  several US states) require a salary range. Decide whether `salary` becomes
  required by employing country and who maintains that country list.
- Orgs portal Opening detail heading and breadcrumb show the working-copy
  title before the live title, so a published Opening with an unapproved
  revision is named by its draft. Decide which title names an Opening.
- MCP for Gold Orgs: expose the Opening operations through `mcp-server`
  under the Org user's permissions, as `openings.md` OPN-GEN-005 allows.

## AI assistance

Org Opening drafting is built ([`agent-guides/ai.md`](../agent-guides/ai.md)).
Not built:

- Hub AI. Decided: the paid Hub plan gets a monthly grant and may buy packs
  with the Org expiry rules, metered like Orgs in the Hub user's home tenant.
  Decide the grant size, the first Hub operation, and where Hub users see
  their usage and kept text.
- Real payments for credit packs; purchases are simulated. Decide with the
  Org payments integration: refunds, tax, invoices, and unused purchased
  credits.
- Production hosting: no `deploy/` tenant has an `ai` block. Decide GPU sizing
  per region, model versions (DEU: DeepSeek and Mistral; USA1, SGP, IND1:
  Gemma, whose licence is not open source), data processing agreements, and
  credit prices.
- AI terms: placeholder text in every `orgs-ui` locale. Replace it before
  launch and decide whether Orgs must accept a later version.
- Streaming answers (server-sent events through `http.ResponseController`);
  answers are complete JSON.
- Decision models (typed-answer classifiers such as Laya): a second model kind
  with its own server and per-decision rates, added with the first operation
  that needs typed decisions.
- Frontier third-party models through in-region enterprise endpoints: the
  catalog allows another host, none is offered.
- Admin reading of kept text needs only `admin:view_ai_usage`; decide whether
  it also needs step-up.
- Candidate scoring or any operation that evaluates people: settle EU AI Act
  high-risk duties (risk management, logging, human oversight) and NYC Local
  Law 144 bias audits first.

## Global portals

- Not built: anonymous Org pages and Openings, anonymous profile viewing,
  search indexing (needs server-side rendering in the home region, never at
  the static host's edge).
- The Vite dev servers cannot call regional APIs (CORS allows only the
  `*.vetchium.localhost` portal origins). Use `make dev` or Tilt, or decide a
  dev-server origin.
- Production TLS issuance and the static-host deploy have not been exercised.
