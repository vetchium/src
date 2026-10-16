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
- MCP for Gold Orgs: expose the Opening operations through `mcp-server`
  under the Org user's permissions, as `openings.md` OPN-GEN-005 allows.

## AI assistance

Not built. Candidate features: a draft from a prompt, structuring a pasted job
description, refining a section on instruction, and an inclusive-language
review before submission. The current leaning is Gold only, with a daily cap
per Org as a plan entitlement, behind a provider-neutral internal interface.
Output only ever fills a working copy that a person reviews and submits; it
passes the same validators, and the model gets no tool with side effects.

Ways to reach a model:

1. MCP first: the Org's own assistant (Claude, ChatGPT, Gemini, or another)
   calls Vetchium's Opening operations through `mcp-server`. Vetchium stores no
   provider key, pays no inference cost, and sends no data to a provider
   itself.
2. Vetchium-managed provider per tenant: a tenant config block names the
   provider endpoint and key file, as `googleSignIn` does; a tenant without it
   hides the feature. In-region endpoints (a cloud provider's regional model
   hosting) keep data residency. Cost is bundled into the plan.
3. Bring your own key per Org: a superadmin sets a provider, model, and API
   key. The Org pays and picks the provider, but Vetchium holds third-party
   secrets (encrypted at rest, write-only, rotatable) and must allowlist
   provider hosts to prevent request forgery to arbitrary URLs. Quality and
   structured-output support differ by provider.
4. Gateway such as OpenRouter: one interface to many models, but another data
   processor in the path. A self-hosted gateway avoids that at an operations
   cost. A gateway is an implementation behind option 2 or 3, not a product
   choice.
5. Vetchium-hosted models per region: the most control over residency and
   cost per call, and the largest investment.
6. Reselling or partnering with model providers: a business decision that
   changes billing, not the interface.

Recommendation: build option 1 first, since it needs no keys and `mcp-server`
already exists. Then add option 2 behind the provider-neutral interface for
in-portal drafting, enabled per tenant. Offer option 3 later to Orgs with their
own provider contracts, restricted to allowlisted hosts. Decide first: data
processing agreements per region, prompt retention (recommended: none; audit
records only that a generation happened), the daily caps, and how invalid model
fields are reported to the user.

## Global portals

- Not built: anonymous Org pages and Openings, anonymous profile viewing,
  search indexing (needs server-side rendering in the home region, never at
  the static host's edge).
- The Vite dev servers cannot call regional APIs (CORS allows only the
  `*.vetchium.localhost` portal origins). Use `make dev` or Tilt, or decide a
  dev-server origin.
- Production TLS issuance and the static-host deploy have not been exercised.
