# Org Subscriptions, Users, and Roles — Implementation Plan

Status: **in progress**. Ledger: §7. Branch: `feature/orgs-plans`.

This plan is self-contained. A session with no prior conversation must be able
to resume from §0 alone. The decisions in §2 are the product owner's and are
fixed: do not re-litigate them. Ask the product owner only when the repository
contradicts a decision or a question in §9 blocks the current milestone.

`CLAUDE.md` says `docs/` holds only `todo.md`. This file is a temporary
exception, like the earlier frontend-consolidation plan. OS-M14 moves every
lasting rule into `agent-guides/` and deletes this file.

## 0. Resume protocol (read first, every session)

1. Read only §0–§4 and §7 of this file. Read §5 only for the current milestone.
2. Run `git status --short` and `git log --oneline main..HEAD`.
3. Find the first unchecked milestone in §7.
   - If the worktree is dirty, the changes belong to that milestone. Inspect
     them with `git diff --stat`, then `git diff <file>`, and continue rather
     than restart.
4. Read only the guides on that milestone's **Read** line, plus `go.md`,
   `typescript.md`, or `typespec.md` when you touch that language.
5. Execute the milestone's **Steps**.
6. When every **Done check** passes:
   1. tick the ledger in §7 and fill in the commit;
   2. append one line to §8 with the date, a short SHA, and any deviation;
   3. commit, with the message given under **Commit**.
7. **At a CHECKPOINT, continue to the next milestone.** Work is committed and
   recorded, so automatic context compaction cannot lose it. Never stop to ask
   the user to run `/compact`. Stop only when the ledger is complete, or for a
   §9 question that blocks you.
8. If a milestone reveals that a §2 decision cannot work as written, stop.
   Record the conflict in §9 and ask the product owner. Do not improvise
   policy.

## 1. Token economy rules

- Run long commands (`make test`, `make playwright-test`, `make test-stack`,
  `go test ./...`) with a log in the session scratchpad, never in the repo, and
  print only the exit code and the tail:

  ```sh
  make X > "$SCRATCH/X.log" 2>&1; echo "exit=$?"; tail -40 "$SCRATCH/X.log"
  ```

  Find failures with `grep -nE 'FAIL|Error|✘' "$SCRATCH/X.log" | head -40`.
  Never print a whole log.
- Run `make test` and `make playwright-test` with `run_in_background` and wait
  for the completion notice instead of polling.
- Read files in ranges: `grep -n` first, then `sed -n 'a,bp'`. Never read
  `db/migrations/00001_init.sql` (1700+ lines) whole.
- Copy an existing pattern instead of re-deriving it. Each milestone names its
  **Model** files; read those before writing new code.
- Use subagents only where a milestone says so. Give each one a self-contained
  prompt (goal, relevant §2 rows, exact files) and ask for at most 30 lines
  back. Never paste a report into this file.
- Commit at the end of every milestone. Subject in the imperative, a short
  body, **no AI attribution of any kind** (`CLAUDE.md`). Run
  `git diff --check` and read `git status` first.
- Run `make fmt` before every commit.

## 2. Fixed decisions

### Plans and entitlements

| # | Decision |
| --- | --- |
| D1 | Three Org plans, with stable OIDs and unique ranks: `org-free-tier` (1000), `org-silver-tier` (2000), `org-gold-tier` (3000). A higher rank includes everything a lower rank allows. |
| D2 | Entitlements are contract constants in `typespec/orgs/subscriptions/plans.*` (TypeSpec extension, Go, TS), the single authority, like Hub ranks. **Users:** Free 5, Silver 50, Gold 1000, or **unlimited while the Org has Google sign-in enabled** (D2a). **Openings per rolling 365 days:** 25 / 250 / 2500. **Org logo:** Silver+. **Google sign-in:** Gold. **Ticket-based support:** Gold. No other plan value is unlimited. |
| D2a | The Gold user cap depends on the Org's `google_sign_in_enabled`: 1000 when it is off, no cap when it is on. Turning Google sign-in off is refused with `org-user-limit-exceeds-target` while seats exceed 1000, just as a downgrade is (D13). Leaving Gold needs seats ≤ 50 first, so it never meets this case. The deadline path (D10) disables down to 5 regardless. |
| D3 | Pricing is a **flat price per plan and interval** (monthly or annual), not per seat. As for Hub, the portal owns the simulated display prices, keyed by tenant, plan, and interval. Annual costs 11× monthly and prices include tax. INR is about 100× the USD number. Monthly prices: Silver 50 USD/EUR/SGD or 5000 INR; Gold 200 USD/EUR/SGD or 20000 INR. The product owner may change the numbers without a plan change. |
| D3a | The plan page labels paid prices **"Introductory pricing"** and states: "Paid plans fund the development of Vetchium, a free and open-source project." Both are portal strings in every locale, not contract values. |
| D3b | The Gold comparison lists **Ticket-based support** and **MCP support**, both labelled **"Coming soon"**. Ticket support is a contract entitlement now (`IncludesTicketSupport`), so the future ticketing feature gates on it. Neither has a portal entry point yet: ticketing (built in or a SaaS integration) and MCP are in `docs/todo.md`. MCP support is display-only, with no contract value until it is built. |
| D4 | Each tenant config declares `orgBilling.offeredPlans`, which must include `org-free-tier`. The orgs-ui region table carries `orgPlans` per tenant, and `portal_regions_test.go` keeps the two equal (the same pattern as `hubPlans`). |

### Subscription lifecycle

| # | Decision |
| --- | --- |
| D5 | **Timing follows Hub.** An upgrade (higher rank, or the same plan going monthly to annual) applies immediately, charges immediately, and starts a new period, with no proration in simulation. A downgrade or cancellation (lower rank, or annual to monthly) is scheduled for period end, keeping access until then. Reselecting the current plan and interval clears a scheduled change. Periods use Hub's anchor-day UTC rule. |
| D6 | **Payment methods are simulated test cards** (as in Stripe test mode). An Org has at most one saved method: `simulated-succeeds` ("ending 4242") or `simulated-declines` ("ending 0002"). There is no real card data, no environment flag, and the same behavior everywhere. The UI states that payments are simulated. |
| D7 | **Auto-charge with invoice fallback.** Every charge creates an invoice row. An upgrade charges the saved method at once; with no method, or a decline, the upgrade is refused and nothing changes. A renewal auto-charges at period end. On success the invoice is `paid`. On a decline or no method, the invoice is `open` with `due_at = period_end + gracePeriod`, the Org becomes **past due**, and service continues on the paid plan during grace. |
| D8 | **Grace is 14 days in production.** Auto-retries happen at +3, +7, and +11 days. Billing holders are emailed when the payment fails and at 7, 3, and 1 days before `due_at`. All durations are `orgBilling` config keys with shorter dev and CI values (§3). |
| D9 | While past due, a billing holder can pay the open invoice (it charges the saved method), replace or remove the payment method, and read billing. `set-subscription-plan` is refused with `org-billing-past-due`. |
| D10 | **At the deadline** (`due_at` passes with the invoice still open), one transaction runs: the invoice becomes `void`; the Org drops to `org-free-tier` and its schedule is cleared; every pending invitation is cancelled; active users beyond the **keep set** are disabled with reason `nonpayment` and their sessions revoked; the logo is removed (D21); Google sign-in is turned off (D24). One audit event records it, and emails go to the disabled users and to the kept billing holders. Paying later is a fresh upgrade that starts a new period. |
| D11 | **The keep set** is 5 active users. Order active users by: holds `org:superadmin` first, then holds `org:manage_billing`, then join date (`org_users.created_at`) oldest first, then `org_user_id`. Keep the first 5. This always keeps at least one superadmin, so the lockout invariant holds. |
| D12 | **Re-enabling is manual, one user at a time,** by a `org:manage_users` holder, within the current cap. Nothing re-enables automatically after payment. |
| D13 | **A downgrade is blocked until the Org fits.** Scheduling a downgrade is refused with `org-user-limit-exceeds-target` while active users plus pending invitations exceed the target cap. While a downgrade is scheduled, the effective cap for invites and re-enables is the lower of the current and scheduled caps, so the transition can never find excess users. |
| D14 | **Ending-entitlement notices** follow Hub PROF-SUB-001: only a rank-lowering scheduled change warns. Billing holders see an in-portal banner for the final 7 days and get email at 7 days and at 1 day. |
| D15 | **Warnings reach every user.** While the Org is past due, every signed-in Org user sees a banner with the deadline, saying users may be disabled. Billing holders also get "Pay now". `my-info` carries this notice. |

### Users, roles, invitations

| # | Decision |
| --- | --- |
| D16 | **Roles are permissions.** The catalog gains `org:manage_users` and `org:manage_billing`; `org:superadmin` implies both (one hop). The UI offers **presets** that only pre-tick checkboxes: *Superadmin* = {superadmin}, *Finance* = {manage_billing}, *User manager* = {manage_users}, *Member* = {}. The checkboxes, built from the catalog, stay authoritative. `authorization.md` gains this exception. |
| D17 | **Delegation:** `org:manage_users` may invite, list, disable, and re-enable users, and grant or revoke `org:manage_users` (and any later permission below it). Only `org:superadmin` may grant or revoke `org:superadmin` or `org:manage_billing` (on invite or later), or disable or re-enable a user holding `org:superadmin`. Changing an existing user's grants requires step-up. Inviting and disabling do not. The lockout invariant (an active Org keeps an active superadmin) is a predicate in every disabling and revoking statement. |
| D18 | **Seats** = active users + unexpired pending invitations. Users disabled for any reason do not count. Invite, accept, and re-enable all check the cap while holding the Org row lock. Invitees must be on the Org's domain (an exact match with `org_domains.domain`). Invitations live for `orgsAPIServer.invitationTTL` (`168h`). Accepting one sets a password and creates the active user; the user's join date is the acceptance time. |
| D19 | A user disabled for nonpayment who signs in gets `org-user-disabled-nonpayment`, a distinct problem the UI explains: "Your account was disabled because your organization's subscription was not paid. Contact your organization's administrator." A manual disable keeps `org-user-disabled`. |
| D20 | Org users are identified on the wire by **email address** within their Org, never by internal ID. |

### Member management at scale (Gold Orgs can hold thousands of users)

Follows the member administration of Claude and ChatGPT team plans:

- one role per member from a short list;
- a searchable member list;
- only the top role can grant the top role;
- pending invitations take seats and can be resent or revoked;
- bulk add from pasted addresses or CSV;
- CSV export of members;
- billing separated from member administration;
- removal takes effect immediately;
- SCIM, groups, and custom roles reserved for later.

| # | Decision |
| --- | --- |
| D31 | **The member list is role-first.** Each row shows email, a **Role** label, state (with disabled reason), join date, and last sign-in. The label is the matching preset (D16) or **Custom** when the grants match none. Grants stay the stored truth; the role label is derived from them in the portal, never stored. A per-row role dropdown applies a preset, and a **Custom…** drawer shows the catalog checkboxes. The per-user permission matrix is never shown as table columns. |
| D32 | **`list-users` is server-side search, filter, and keyset pagination:** an email substring search (case-insensitive, at least 2 characters); filters for state (`active`, `disabled-manual`, `disabled-nonpayment`) and for holding a given permission, or no permission at all; sort by email or join date; page size up to 100, default 50. A summary call returns the number of users per state and per directly granted permission, so the page can show "3 superadmins · 2 finance · 990 members" with links that apply the filter. |
| D33 | **Bulk actions on selected rows** (at most 100 per request): `bulk-set-user-permissions` (one set of grants for all, which is how presets apply in bulk; step-up), `bulk-disable-users`, and `bulk-enable-users`. Each runs in one transaction under the Org row lock and is all-or-nothing. D17 delegation is checked for every target; the lockout predicate covers the whole set; enable checks the cap for the whole batch. A refusal names the first offending email. Audit records one event per bulk operation, listing the targets. |
| D34 | **Bulk invite:** `invite-users` takes up to 100 addresses and one set of grants. The portal accepts pasted addresses (comma or newline separated) or a CSV file it parses locally, and splits larger lists into sequential requests of 100, each with its own idempotency key. Seats for the whole request are checked atomically, so the request is refused if it would exceed the cap. Otherwise each address gets its own outcome: `invited`, `already-member`, `already-invited`, `domain-mismatch`, or `invalid`. |
| D35 | **Invitations view:** a separate tab with the same search and pagination, plus resend (rotates the token and restarts the TTL) and cancel. Bulk cancel takes at most 100. |
| D36 | **CSV export** of the member list (email, role label, permissions, state, join date, last sign-in) is generated in the browser by paging `list-users`, so there is no export endpoint or server-side file. Available to `org:manage_users`. |
| D37 | **Not built** (recorded in `docs/todo.md`): groups, custom roles beyond the catalog, SCIM provisioning, invite links, domain auto-join, and an Org-facing audit log viewer. SCIM is the expected next step for large SSO Orgs. |
| D38 | **Guard rails:** no one can disable themselves or change their own grants (`org-self-change-forbidden`); another administrator must do it. Grant changes take effect on the user's next request, because the guard reads the effective-permission view every request; no sign-out is needed. Disabling revokes every session of that user at once. Disabled users keep their data and can be re-enabled. Users are never deleted. |

### Logo and Google sign-in

| # | Decision |
| --- | --- |
| D21 | **Org logo (Silver+).** It mirrors the Hub profile-picture pipeline (`object-storage.md`): PNG or JPEG, 128–4096 px per side, at most 2 MiB, and the gated write predicates on the plan. When the Org drops below Silver, the transition transaction removes the logo reference and queues deletion of the object. A later upgrade does not restore it. |
| D22 | **Google sign-in (Gold).** OIDC authorization code flow with PKCE and a nonce. It succeeds only when the ID token is valid (issuer, audience, expiry, nonce), `email_verified` is true, `hd` equals the Org domain, the email's domain equals the Org domain, the email matches an **existing active** Org user, the Org is on Gold, and a superadmin enabled it. There is no auto-provisioning. On the first success, link the Google `sub` to the user. After that, match by `sub`, and refuse if the `sub` links to a different user. |
| D23 | Google sign-in **skips Vetchium TOTP**; the Workspace admin's 2-Step Verification is the second factor. Password sign-in still requires TOTP when enrolled. Every user keeps a password, which serves as fallback and step-up. |
| D24 | A superadmin turns Google sign-in on or off in Org settings (Gold required, step-up). Leaving Gold turns it off in the transition transaction. |
| D25 | The mechanism is provider-neutral: a `backend/internal/oidc` package, credential table `org_user_sso_identities (provider, subject)`, and per-provider tenant config. Google is the only provider now; SAML and others come later as further credential kinds. Dev and CI run a pinned mock OIDC provider container that issues `hd` claims; there is no code bypass. |

### Scope and operations

| # | Decision |
| --- | --- |
| D26 | **Openings are not built.** This plan defines only the per-plan quota constant, a quota helper, and the counting rule (published in the last 365 days, checked atomically in the publish statement under the Org row lock), recorded in the guide for the future Openings feature. |
| D27 | **Suspended Orgs** (domain failure) may still use the billing reads, `set-payment-method`, `remove-payment-method`, and `pay-invoice`. Every new non-billing route is refused by the Org-suspended middleware this plan adds (`orgs.md` requires it from the first non-account route). |
| D28 | Concurrency follows Hub. Lock the `orgs` row `FOR UPDATE` before any billing, seat, or permission decision. Workers claim batches with `SKIP LOCKED`. One pure rule, `backend/internal/orgs/billing.Advance`, decides every period transition. The worker, set-plan, and pay-invoice persist due transitions; reads compute them in memory and write nothing. |
| D29 | Every state change writes an audit event in the same transaction (`database.md`). |
| D30 | Billing is separate from member administration. The User manager preset handles members, Superadmin holds everything, and Finance is billing-only. |

## 3. Conventions

### Configuration (`orgBilling`, a new top-level tenant block, read by orgs-api and workers)

| Key | Production | Development | CI |
| --- | --- | --- | --- |
| `offeredPlans` | all three | all three | all three in `sgp`, `deu`, `ind1`; free + silver in `usa1` (exercises the "not offered" path) |
| `gracePeriod` | `336h` | `1h` | `12s` |
| `retryOffsets` | `["72h","168h","264h"]` | `["10m","20m","40m"]` | `["3s","6s","9s"]` |
| `dueWarningLeads` | `["168h","72h","24h"]` | `["30m","15m","5m"]` | `["9s","6s","3s"]` |
| `downgradeWarningLeads` | `["168h","24h"]` | `["168h","24h"]` | `["168h","24h"]` |
| `checkInterval` (worker tick) | `1m` | `10s` | `1s` |

`orgsAPIServer.invitationTTL` is `168h` everywhere. `orgsAPIServer.googleSignIn` holds `issuer`,
`clientID`, `clientSecretFile`, and `redirectURI`. Production uses issuer
`https://accounts.google.com` and redirect
`https://orgs.vetchium.com/sso/google/callback`. Dev and CI point at the mock
provider (`oidc-dev`). Parse every key without a silent default, as
`parseOfferedPlans` does.

### Wire vocabulary

- Plan OIDs: `org-free-tier`, `org-silver-tier`, `org-gold-tier`. Intervals:
  `month`, `year`.
- Payment method kinds: `simulated-succeeds`, `simulated-declines`.
- Billing state: `current`, `past-due`. Invoice state: `paid`, `open`, `void`.
  Invoice reason: `upgrade`, `renewal`.
- User state on the wire: `active`, `disabled`. Disabled reason: `manual`,
  `nonpayment`.
- New problem types, in `typespec/problem/orgs/` with Go and TS companions:
  `org-permission-required`, `org-suspended`, `org-user-limit-reached`
  (carries `limit`), `org-user-limit-exceeds-target` (carries `limit` and
  `seats_in_use`), `org-plan-required` (carries `plan_oid`),
  `org-plan-not-offered`, `org-billing-past-due`,
  `org-payment-method-required`, `org-payment-declined`,
  `org-invoice-not-open`, `org-invitee-domain-mismatch`,
  `org-user-already-exists`, `org-invitation-invalid`,
  `org-last-superadmin`, `org-self-change-forbidden`,
  `org-user-disabled-nonpayment`,
  `org-sso-sign-in-failed`, `org-sso-not-available`. Reuse an existing type
  where one already has the same meaning (check `typespec/problem/orgs/` and
  `common.tsp` first) and record the reuse in §8.

### Endpoints (all `POST` unless noted, under `/api/orgs`)

| Group | Routes | Guard |
| --- | --- | --- |
| Users | `list-users`, `user-summary`, `invite-users`, `list-invitations`, `resend-invitation`, `cancel-invitations`, `disable-user`, `enable-user`, `bulk-disable-users`, `bulk-enable-users` | `org:manage_users` (+ D17) |
| Users | `set-user-permissions`, `bulk-set-user-permissions` | `org:manage_users` + step-up (+ D17) |
| Public | `get-invitation-details`, `accept-invitation` | invitation token |
| Authorization | `GET list-permissions` (the catalog) | signed in |
| Billing | `GET my-subscription`, `list-invoices` | `org:manage_billing` |
| Billing | `set-subscription-plan`, `pay-invoice` (both idempotent) | `org:manage_billing` |
| Billing | `set-payment-method`, `remove-payment-method` | `org:manage_billing` |
| Logo | `logo/upload`, `logo/remove` | `org:superadmin` |
| SSO | `set-google-sign-in` | `org:superadmin` + step-up |
| SSO | `sso/google/start`, `sso/google/complete` | public |
| Existing | `GET my-info` gains `plan_oid`, `billing_notice` (D15, D14), `logo_url`, `google_sign_in_enabled` | signed in |

Mirror the admin contracts for shape and naming: `typespec/admin/users/`
(`invitations.tsp`, `management.tsp`) and
`typespec/admin/authorization/management.tsp`.

## 4. Ownership map

| Owner | Affected |
| --- | --- |
| Contracts | `typespec/orgs/authorization/*` (new permissions and helpers), new `typespec/orgs/users/*`, `typespec/orgs/subscriptions/*`, `typespec/orgs/settings/*`, `typespec/orgs/auth/sso.*`, `typespec/orgs/account/account.*`, `typespec/problem/orgs/*`, `typespec/orgs/orgs.tsp` imports |
| Schema | `db/migrations/00001_init.sql`, edited in place (pre-production: no `ALTER`), down section included; `backend/internal/db/queries/org_*.sql`; generated `backend/internal/db/sqlc/` |
| Shared mechanism | new `backend/internal/billingperiod` (period math extracted from `hub/billing`), new `backend/internal/oidc` |
| Org policy | new `backend/internal/orgs/billing`, `backend/internal/orgs/entitlements`, `backend/internal/orgs/users`; `backend/internal/middleware/orgs_auth.go` (suspended guard, permission guard) |
| Handlers | new `backend/handlers/orgs/{users,subscriptions,settings}`, `backend/handlers/orgs/auth/{login.go,sso.go}`, `backend/handlers/orgs/account/account.go`; `backend/internal/routes/orgs_routes.go` |
| Workers | new `backend/internal/workers/{advance_org_subscriptions,warn_org_billing,delete_org_logos}.go`, `org_jobs.go`, `workers.go`, `backend/cmd/workers` |
| Email | `backend/internal/email/templates/<locale>/org-*` (en-US, de-DE, ta), `backend/internal/orgs/orgmail` |
| Config | `backend/internal/appconfig/config.go` and its tests, `config/*.json`, `config/ci/*.json`, `deploy/*/config.json`, secret files for the Google client secret, `portal_regions_test.go` |
| Stacks | `docker-compose.json`, `docker-compose-ci.json`, `Tiltfile`, `deploy/<r>/stack.json` (the `oidc-dev` container in dev/CI only; orgs-api egress to Google in production) |
| Portal | `orgs-ui/src/{app,api,features,pages,i18n/locales/*}`, new `orgs-ui/src/app/regions/<env>.json` (`orgPlans`), prices |
| Tests | `playwright/lib/orgs-api.ts`, new `playwright/api/orgs-{users,subscriptions,logo,sso}.spec.ts`, `playwright/ui/orgs-{users,plans,sso}.spec.ts`, Go unit and integration tests |
| Seeds | `backend/cmd/dev-seed/orgs.go` (Orgs on each plan, with users); `db/db-seed` only if a catalog needs it |
| Guides and docs | new `agent-guides/org-subscriptions.md`; `orgs.md`, `authorization.md`, `glossary.md`, `object-storage.md` (logo), `CLAUDE.md` guide table, `deploy/README.md` (Google OAuth client), `docs/todo.md` |

## 5. Milestones

`make test` must pass at the end of every milestone from OS-M2 on. Each
milestone is sized for one session of a Sonnet-class model. Each lists its
narrow checks; run `make test` (in the background) as the last Done check.

### OS-M0 — Plan

- **Done check:** this file is committed.
- **Commit:** "Plan Org subscriptions, user management, and roles".
- **CHECKPOINT.**

### OS-M1 — Extract shared billing-period math

- **Read:** `hub-subscriptions.md`, `go.md`, `change-design.md`.
- **Model:** `backend/internal/hub/billing/{period,instant}.go` and their tests.
- **Steps:**
  1. Move the plan-agnostic period math (`Boundary`, `PeriodContaining`, the
     instant helpers, `floorDivMod`, `lastDayOfMonth`) into
     `backend/internal/billingperiod`, parameterized by a months-per-interval
     value, not by Hub types.
  2. Make `hub/billing` call it. Move the matching tests. Change no behavior.
- **Done checks:** `go test ./...` in `backend`; `make test-go-static`;
  `make test`.
- **Commit:** "Extract billing-period math for reuse by Org plans".
- **CHECKPOINT.**

### OS-M2 — Org permissions, plans contract, schema foundation

- **Read:** `authorization.md`, `typespec.md`, `database.md`, `orgs.md`.
- **Model:** `typespec/admin/authorization/types.{tsp,go,ts}` (`Implies`,
  `EffectivePermissions`, `DirectPermissions`);
  `typespec/hub/subscriptions/plans.*`.
- **Steps:**
  1. Contract: add `org:manage_users` and `org:manage_billing` to
     `OrgPermission` and `x-vetchium-known-values`. Set
     `x-vetchium-permission-implications` so superadmin implies both. Add the
     admin-style helpers to Go and TS, with tests.
  2. Contract: `typespec/orgs/subscriptions/plans.*` with `OrgPlan`,
     `OrgPlanOID` (ranks), `BillingInterval`, and the D2 entitlement constants
     as an extension plus Go and TS accessors
     (`MaxUsers(plan, googleSignInEnabled) (n, unlimited)`, where only Gold
     with Google sign-in is unlimited (D2a), `OpeningsPerYear`, `AllowsLogo`,
     `AllowsGoogleSignIn`, `IncludesTicketSupport`, `PlansAtOrAbove`).
     Test that the three representations agree, as Hub's `plans_test.go` does.
  3. Schema: catalog rows and implication rows. Seed `org-silver-tier` and
     `org-gold-tier` into `org_plans`. Add `org_users.disabled_reason`
     (`manual`, `nonpayment`), `disabled_at`, and `disabled_by`, with a CHECK
     tying them to `org_user_state = 'disabled'`.
  4. Middleware: an Org permission guard (the effective permission from the
     view → `org-permission-required`), and the Org-suspended guard (§D27,
     `org-suspended`) to compose on new routes. Unit-test both.
  5. Add the `orgBilling` config block (§3), parsed and validated, to every
     checked-in config, plus `orgsAPIServer.invitationTTL`. Add tests in
     `org_config_test.go`.
  6. `make sqlc`.
- **Done checks:** `make typespec-check`, `make sqlc`, `make sql-check`,
  `make test-go`, `make repository-json-check`, `make test`.
- **Commit:** "Add Org billing and user-management permissions and plan
  contract".
- **CHECKPOINT.**

### OS-M3 — Invitations and acceptance (API)

- **Read:** `backend.md`, `database.md`, `authorization.md`, `playwright.md`.
- **Model:** `backend/handlers/admin/users/invitations.go`,
  `typespec/admin/users/invitations.tsp`, the `admin_invitations` table, the
  Org signup emails, `playwright/api/admin-users-authorization.spec.ts`.
- **Steps:**
  1. Table `org_user_invitations`: Org, email, token hash, permissions
     `text[]`, invited_by, expires_at, consumed_at, active. Allow one active
     invitation per (Org, email).
  2. `backend/internal/orgs/users`: a seat counter (active users + unexpired
     active invitations) and the effective cap. The cap is the lower of the
     current and scheduled plan caps (D13); with no schedule it is the current
     cap, and Gold is uncapped when Google sign-in is enabled (D2a). Until
     OS-M11 adds the column, treat Google sign-in as off. Every
     seat-consuming statement runs after `SELECT … FROM orgs … FOR UPDATE`.
  3. Contracts and handlers:
     - `invite-users`: up to 100 addresses, outcomes per address (D34), D17
       delegation, the D18 domain rule, and an all-or-nothing cap check;
     - `list-invitations`: search and keyset pagination, as D32;
     - `resend-invitation` (D35) and `cancel-invitations` (up to 100);
     - `get-invitation-details`;
     - `accept-invitation`: password rules as at signup; re-checks the cap;
       inserts the invitation's grants, filtered to the catalog.

     Queue each invitation email in the inviter's chosen language (en-US,
     de-DE, ta templates). The link is
     `orgs.vetchium.com/accept-invitation?token=…&region=…`. A batch of 100
     queues 100 outbox rows in the same transaction.
  4. Prune expired invitations in Org housekeeping.
  5. Audit every write; a bulk invite is one event listing the addresses.
     Playwright API tests cover every non-5xx response in each union,
     delegation refusals, the Free cap of 5 counting pending invitations, a
     batch exceeding the cap, mixed outcomes per address, resend invalidating
     the old token, and an expired token.
- **Done checks:** `make typespec-check`, `make sql-check`, `make test-go`,
  `make playwright-check`, `make test`.
- **Commit:** "Add Org user invitations".
- **CHECKPOINT.**

### OS-M4 — User listing, disable, enable, permissions (API)

- **Read:** `authorization.md` (lockout invariant), `database.md`.
- **Model:** `backend/handlers/admin/users/users.go`, `SetAdminPermissions`
  and `DisableAdminUser` in `backend/internal/db/queries/admin*.sql`,
  `typespec/admin/users/management.tsp`.
- **Steps:**
  1. `list-users` (D32): search, filters, sort, keyset pagination, and per
     user the email, state, disabled reason, direct grants, effective
     permissions, join date, and last sign-in. `user-summary` returns counts
     per state and per directly granted permission, plus `seats_in_use` and
     `seat_limit`. Back the email search with a `pg_trgm` index only if
     `database.md` allows it; otherwise use a bounded `ILIKE` scan within the
     Org and note it in §8.
  2. Single and bulk forms (D33) share one query each, taking an array of
     emails. A single call is a bulk call of one; do not write two code
     paths.
     - `disable-user` and `bulk-disable-users`: reason `manual`; revoke
       sessions; lockout predicate over the set → `org-last-superadmin`;
       D17.
     - `enable-user` and `bulk-enable-users`: cap check for the batch under
       the lock; works for either disabled reason; D17.
     - `set-user-permissions` and `bulk-set-user-permissions`: step-up; D17
       for every target; lockout predicate; send grants with
       `DirectPermissions`.
  3. Refuse every self-targeted disable or grant change (D38). Never put
     a session or effective permission into a cache that outlives the
     request.
  4. `GET list-permissions` returns the catalog.
  5. Login: a disabled user with reason `nonpayment` →
     `org-user-disabled-nonpayment` (D19), placed exactly where
     `org-user-disabled` is decided today.
  6. Audit (one event per bulk call). Playwright API tests cover every
     single and bulk route: delegation for a mixed batch, self-change
     refusal, the lockout across a batch that would disable every
     superadmin, step-up, the batch cap on enable, the 101-target refusal, search and filter results, summary
     counts, and both disabled problems at login (set the reason up with a DB
     helper; OS-M8 tests the real path).
- **Done checks:** as OS-M3.
- **Commit:** "Add Org user listing, disabling, and permission management".
- **CHECKPOINT.**

### OS-M5 — User management UI

- **Read:** `ui.md`, `typescript.md`, `authorization.md` (screens),
  `playwright.md`.
- **Model:** admin-ui's user management pages; orgs-ui `SecurityPage.tsx` and
  `ReauthenticatePage.tsx` (step-up offer).
- **Steps:**
  1. Navigation is driven by the effective permissions in `my-info`.
  2. A Members page (D31, D32):
     - a summary strip from `user-summary` (seats used out of the limit,
       counts per role and state, each a filter link);
     - a debounced search box, state and role filters, and an Ant Design
       `Table` with server-side keyset pagination; a page of 1000 rows is
       never fetched;
     - columns: email, Role label, state with disabled reason, join date,
       last sign-in;
     - a per-row role dropdown (presets, and **Custom…**, which opens the
       checkbox drawer), and per-row disable and enable.
     The role label derives from direct grants: an exact preset match, else
     Custom.
  3. Row selection with a bulk action bar (D33): Set role, Disable, Enable.
     A selection is capped at 100 with a visible notice. Step-up is offered
     on `recent-authentication-required`. A refusal shows the offending email.
  4. An invite modal (D34): paste addresses or choose a CSV, a preset radio
     plus catalog checkboxes, and a per-address results table. Presets the
     viewer cannot grant are disabled. Unknown permissions are shown raw and
     preserved.
  5. An Invitations tab (D35) with search, resend, and cancel (single and
     bulk).
  6. **Export CSV** (D36), with progress while paging.
  7. A public `accept-invitation` page that reads `region=`.
  8. Login shows the D19 message for `org-user-disabled-nonpayment`.
  9. Strings in en, de, and ta. Playwright UI tests: bulk invite with mixed
     outcomes, accept and sign in, the role dropdown, Custom, a bulk role
     change with step-up, search and filter narrowing the table,
     disable/enable, CSV export contents, and the nonpayment login message.
     Seed test volume through the API, not the UI.
- **Done checks:** `make orgs-ui-check`, `make playwright-check`, `make test`.
- **Commit:** "Add Org user management to the Orgs portal".
- **CHECKPOINT.**

### OS-M6 — Subscription schema and billing policy (pure)

- **Read:** `hub-subscriptions.md` (in full), `database.md`, `go.md`.
- **Model:** the `hub_users` subscription columns and CHECKs,
  `backend/internal/hub/billing/{advance,change,state,events}.go` and their
  tests.
- **Steps:**
  1. Schema on `orgs`: `org_billing_interval`, `subscription_anchor_at`,
     `subscription_period_start`, `subscription_period_end`,
     `scheduled_org_plan_oid`, `scheduled_billing_interval`,
     `billing_state` (`current` or `past_due`), and `subscription_source`.
     The CHECKs mirror Hub's free-has-no-period and scheduled-consistency
     rules, plus: past_due ⇒ paid plan. Tables:
     - `org_payment_methods` (Org PK, kind, created_by, created_at);
     - `org_invoices` (random UUID id, Org, plan, interval, period start and
       end, reason, state, `due_at`, `attempt_count`, `next_attempt_at`,
       `last_failure` (`declined` or `no_payment_method`), `paid_at`,
       `paid_by`, `voided_at`), at most one `open` per Org (partial unique
       index);
     - `org_billing_notices` (Org, key, lead) with a unique key, as in
       `hub_subscription_expiry_notices`.
  2. `backend/internal/orgs/billing`, all pure functions with exhaustive
     table tests:
     - `Advance(state, now, cfg)` returns the due transitions: renewal (charge
       outcome supplied by a `Charger` interface), retry, deadline
       enforcement, and scheduled downgrade.
     - `Decide(state, request)` for set-plan: upgrade, downgrade, clearing a
       schedule, `past_due` refusal, and the D13 target-cap refusal (seat
       count passed in).
     - `KeepSet(users)` implements D11.
     - Notice selection (D8, D14) with the "only the latest lead inside its
       window" rule.
  3. A simulated `Charger`: the outcome depends only on the payment method's
     kind.
- **Done checks:** `make sqlc`, `make sql-check`, `go test ./...`,
  `make test-go-static`, `make test`.
- **Commit:** "Add Org subscription schema and billing policy".
- **CHECKPOINT.**

### OS-M7 — Billing API

- **Read:** `hub-subscriptions.md`, `backend.md`, `playwright.md`.
- **Model:** `backend/handlers/hub/subscriptions/subscriptions.go`,
  `typespec/hub/subscriptions/subscriptions.tsp`,
  `playwright/api/hub-subscriptions.spec.ts`,
  `playwright/lib/billing-periods.ts`.
- **Steps:**
  1. Contracts and handlers:
     - `my-subscription` (plan, interval, period, schedule, billing state,
       open invoice, payment method summary, seats in use and limit; read-only
       in-memory advancement);
     - `set-subscription-plan` (idempotent; lock; persist due transitions;
       `Decide`; charge immediately for an upgrade, refusing with
       `org-payment-method-required` or `org-payment-declined` and no state
       change; `org-plan-not-offered`);
     - `set-payment-method` and `remove-payment-method`;
     - `list-invoices` (keyset);
     - `pay-invoice` (idempotent; only `open` → `paid`; on success return to
       `current` with the period unchanged).
  2. `my-info` gains `plan_oid` and `billing_notice` (D14 for billing
     holders, D15 for everyone).
  3. Audit every transition with the actor rules in `hub-subscriptions.md`.
  4. Playwright API tests cover every response, including upgrade with a
     declining card, downgrade blocked by seats, a schedule lowering the cap
     for invites, and past-due refusal of set-plan. Put the Org into past-due
     by moving `subscription_period_end` into the past with a setup DB helper
     and letting the OS-M8 worker run; until OS-M8 lands, test only what the
     API alone produces.
- **Done checks:** as OS-M3.
- **Commit:** "Add Org subscription and simulated payment API".
- **CHECKPOINT.**

### OS-M8 — Billing workers and enforcement

- **Read:** `backend.md` (workers), `database.md`, `hub-subscriptions.md`.
- **Model:** `backend/internal/workers/{advance_hub_subscriptions,warn_hub_subscription_expiry,org_jobs}.go`
  and their tests; the `subscription-ending` and `org-suspended` email
  templates.
- **Steps:**
  1. `advance_org_subscriptions`: `SKIP LOCKED` batches; renew and
     auto-charge; schedule retries; apply scheduled downgrades; deadline
     enforcement exactly as D10, in one transaction with `KeepSet`, session
     revocation, invitation cancellation, and audit. Leave logo removal and
     Google sign-in shutdown as clearly marked hooks; OS-M10 and OS-M11 fill
     them in.
  2. `warn_org_billing`: emails to active billing holders for payment failed,
     due in 7/3/1 days, and downgrade in 7/1 days. Send a "disabled for
     nonpayment" email to each disabled user and an "Org moved to Free" email
     to the kept billing holders. Templates in all three locales.
  3. Register the jobs with the `orgBilling.checkInterval` cadence.
  4. Playwright API tests, end to end with the CI durations:
     - a declining card at renewal leads to past due, the banner in
       `my-info` for a non-billing user, retries, then the deadline: plan is
       Free, exactly the D11 keep set stays active, the others get
       `org-user-disabled-nonpayment` at login, and invitations are
       cancelled;
     - paying before the deadline restores `current`;
     - after the deadline, an upgrade plus a one-by-one `enable-user`
       restores users up to the cap.
  5. Go tests for the workers' query paths, following the Hub worker tests.
- **Done checks:** as OS-M3.
- **Commit:** "Renew, dun, and enforce Org subscriptions in workers".
- **CHECKPOINT.**

### OS-M9 — Plans and billing UI

- **Read:** `ui.md`, `hub-subscriptions.md` (portal rules), `playwright.md`.
- **Model:** `hub-ui/src/pages/PlanPage.tsx`,
  `hub-ui/src/features/subscriptions/*`, `hub-ui/src/app/regions/*.json`,
  `playwright/ui/hub-plans.spec.ts`.
- **Steps:**
  1. Add `orgs-ui/src/app/regions/{dev,ci,production}.json` with `orgPlans`.
     Extend `portal_regions_test.go` to check them against
     `orgBilling.offeredPlans`.
  2. `orgs-ui/src/features/subscriptions/prices.ts` (D3 prices; a unit test
     checks that each INR price is 100× its USD price).
  3. A Plan and billing page (billing holders): a plan comparison built from
     the contract entitlements (Gold users shown as "1000, unlimited with
     Google sign-in"), plus the D3b rows (Ticket-based support and MCP
     support, both "Coming soon"), the D3a introductory-pricing label and
     FOSS note, the current
     plan, interval toggle, upgrade,
     downgrade (showing the seat-limit refusal clearly), clearing a schedule,
     the payment method card picker (labelled simulated), an invoices table,
     and Pay now.
  4. Banners in the shell: past due for everyone (D15), ending entitlement
     for billing holders (D14), and "no payment method" for billing holders
     on a paid plan.
  5. Handle an unknown plan OID as Hub does.
  6. Strings in en, de, and ta. Playwright UI tests: upgrade, switch to the
     declining card, the banner seen by a member, and pay.
- **Done checks:** `make orgs-ui-check`, `go test ./internal/appconfig/...`,
  `make playwright-check`, `make test`.
- **Commit:** "Add Org plans and billing to the Orgs portal".
- **CHECKPOINT.**

### OS-M10 — Org logo (Silver+)

- **Read:** `object-storage.md`, `hub-profile.md` (picture rules),
  `database.md`.
- **Model:** `typespec/hub/profile/picture.tsp`, the Hub picture handlers,
  `hub_profile_picture_objects`, `delete_hub_profile_pictures.go`,
  `playwright/api/hub-profile-picture.spec.ts`.
- **Steps:**
  1. Table `org_logo_objects` and a logo reference on `orgs`. Add
     `logo/upload` and `logo/remove`; the gated write predicates on
     `org_plan_oid = ANY(Silver+)` → `org-plan-required`.
  2. `my-info.logo_url` uses the existing signed media delivery.
  3. Fill the OS-M8 hook: every transition below Silver (downgrade or
     deadline) clears the reference and queues deletion. Add
     `delete_org_logos` worker.
  4. UI: an Org settings page (superadmin) with logo upload and removal, an
     upgrade prompt on Free, and the logo in the shell.
  5. Tests: API (plan gate, formats and sizes, removal on downgrade) and UI.
- **Done checks:** as OS-M3 plus `make orgs-ui-check`.
- **Commit:** "Add Org logos for Silver and Gold".
- **CHECKPOINT.**

### OS-M11 — Google sign-in backend (Gold)

- **Read:** `backend.md`, `orgs.md` (sign-in), `authorization.md` (step-up),
  `mesh-topology.md` (networks), `object-storage.md` (topology test pattern
  only).
- **Model:** `orgs-api` login and session creation
  (`backend/handlers/orgs/auth/login.go`), the `dns-dev` service in the
  compose files.
- **Steps:**
  1. Choose a maintained OIDC library (for example
     `github.com/coreos/go-oidc/v3` with `golang.org/x/oauth2`) after checking
     its current docs. Record the choice in §8. `backend/internal/oidc`:
     discovery, PKCE, nonce, ID token verification.
  2. Dev and CI provider: a pinned (version and digest) mock OIDC image that
     can issue `email`, `email_verified`, and `hd` claims chosen per login. If
     none can, write a minimal dev-only Go provider under `dev/`. Add it to
     `docker-compose.json`, `docker-compose-ci.json`, and the `Tiltfile`;
     never to `deploy/`.
  3. Config `orgsAPIServer.googleSignIn` (§3) and a secret file per tenant.
     Make sure production orgs-api can reach Google over HTTPS; record any
     network change in `deploy/README.md`.
  4. Schema:
     - `org_user_sso_identities` (user, provider, subject; unique on
       (provider, subject));
     - `org_sso_login_states` (state hash, nonce, encrypted PKCE verifier,
       domain, expiry of 10 min, single use);
     - `orgs.google_sign_in_enabled`, with a CHECK that it is false unless
       on Gold.
  5. Endpoints:
     - `sso/google/start` takes `{domain}` and returns
       `{authorization_url}`; the answer is identical for any domain, and
       `hd` is passed as a hint;
     - `sso/google/complete` takes `{state, code}` and applies D22 and D23
       in order, answering with the same session response as login or a
       generic `org-sso-sign-in-failed`, except
       `org-user-disabled-nonpayment`, `org-user-disabled`, and
       `org-suspended`, which follow the password-login conventions;
     - `set-google-sign-in` (superadmin, step-up, Gold, else
       `org-plan-required`). Turning it off runs under the Org row lock and
       is refused with `org-user-limit-exceeds-target` while seats exceed
       1000 (D2a).
  6. Fill the OS-M8 hook: leaving Gold sets `google_sign_in_enabled = false`.
     Switch the OS-M3 seat cap to read the column, so a Gold Org with Google
     sign-in is uncapped.
  7. Playwright API tests against the mock covering each D22 refusal: wrong
     `hd`, unverified email, unknown user, not Gold, not enabled, a
     `sub` already linked to another user, and replayed state. Cover D2a too:
     with Google sign-in enabled, invite past 1000 (seed with bulk
     `invite-users` in batches of 100), then confirm that turning it off is
     refused.
- **Done checks:** as OS-M3 plus `make repository-json-check`.
- **Commit:** "Add Google sign-in for Gold Orgs".
- **CHECKPOINT.**

### OS-M12 — Google sign-in UI

- **Read:** `ui.md` (regions, signed-out flows), `playwright.md`.
- **Steps:**
  1. Login page: after region and domain, a "Sign in with Google" button.
     Store the region in session storage before redirecting.
  2. Add a `/sso/google/callback` route that completes in that region and
     shows a generic failure.
  3. Org settings: a Google sign-in toggle (Gold, superadmin, step-up, with an
     upgrade prompt otherwise).
  4. Confirm the CSP needs no change, since the Google step is a top-level
     navigation.
  5. Strings in en, de, and ta. A Playwright UI test of the full round trip
     through the mock provider.
- **Done checks:** `make orgs-ui-check`, `make playwright-check`, `make test`.
- **Commit:** "Add Google sign-in to the Orgs portal".
- **CHECKPOINT.**

### OS-M13 — Openings quota, seeds, guides

- **Read:** `CLAUDE.md` (documentation rules), `review.md`.
- **Steps:**
  1. `backend/internal/orgs/entitlements`: an `OpeningQuota` helper and doc
     comment stating the D26 counting rule. Unit tests only.
  2. `dev-seed`: one Org per plan per tenant, with users holding each preset,
     created through the portal APIs.
  3. Guides:
     - new `agent-guides/org-subscriptions.md`, the lasting rules from §2 in
       the terse style of `hub-subscriptions.md`;
     - update `orgs.md` (permissions and plans sections), `authorization.md`
       (Org row, presets exception, delegation), `glossary.md` (seat,
       invoice, past due, grace period, keep set, preset),
       `object-storage.md` (logo);
     - add a row to the `CLAUDE.md` guide table;
     - `deploy/README.md`: register the Google OAuth client and set the
       secret file.
  4. `docs/todo.md`: remove the items now built (Org user management, Org
     plan selection, logo, the suspended-Org middleware, the superadmin
     invariant writer). Add real Org payments, Openings enforcement, SAML,
     MCP support for Gold, the D37 items (groups, custom roles, SCIM, invite
     links, domain auto-join, Org audit log viewer), and every question left
     in §9. Gold ticket support is already listed; keep it.
- **Done checks:** `make test`.
- **Commit:** "Document Org subscriptions and seed Orgs on every plan".
- **CHECKPOINT.**

### OS-M14 — Review and close-out

- **Read:** `review.md`.
- **Steps:**
  1. Run `make test-go-lint` and `make test-go-vuln`.
  2. Run one independent review subagent (`general-purpose`) over
     `git diff main...HEAD`, with `review.md` and §2 as the checklist. Fix
     every confirmed finding.
  3. Run `make test` in full.
  4. Delete this file (its lasting content now lives in the guides).
- **Done checks:** a clean `make test`; this file removed.
- **Commit:** "Close out the Org subscriptions plan".
- **Done.**

## 6. Invariants every milestone must keep

- An active Org always has an active `org:superadmin` holder.
- Seats in use never exceed the effective cap, except for the window D10
  closes in one transaction. Gold is uncapped only while Google sign-in is
  enabled.
- Every bulk operation is at most 100 targets, all-or-nothing, and one audit
  event.
- At most one `open` invoice per Org; past due ⇔ an open invoice exists.
- The free plan has no period, interval, invoice, or schedule.
- A plan-gated write predicates on the plan in the same statement.
- No permission literal outside the contract vocabulary and named DB
  invariants.

## 7. Ledger

| Milestone | Done | Commit |
| --- | --- | --- |
| OS-M0 Plan | [x] | OS-M0 commit |
| OS-M1 Billing-period extraction | [x] | a6eae7e |
| OS-M2 Permissions, plan contract, schema foundation | [ ] | |
| OS-M3 Invitations API | [ ] | |
| OS-M4 User management API | [ ] | |
| OS-M5 User management UI | [ ] | |
| OS-M6 Subscription schema and billing policy | [ ] | |
| OS-M7 Billing API | [ ] | |
| OS-M8 Billing workers and enforcement | [ ] | |
| OS-M9 Plans and billing UI | [ ] | |
| OS-M10 Org logo | [ ] | |
| OS-M11 Google sign-in backend | [ ] | |
| OS-M12 Google sign-in UI | [ ] | |
| OS-M13 Openings quota, seeds, guides | [ ] | |
| OS-M14 Review and close-out | [ ] | |

## 8. Log

One line per finished milestone: `YYYY-MM-DD <sha> OS-Mx — deviation or "as
planned"`.

- 2026-10-02 OS-M0 — as planned (the plan commit itself).
- 2026-10-03 a6eae7e OS-M1 — `billingperiod` takes a month count; `hub/billing` keeps thin wrappers (`Boundary`, `PeriodContaining`, `Instant`) so callers are unchanged.

## 9. Open questions

None blocking. Product decisions intentionally deferred to `docs/todo.md` at OS-M13: real payment processors and tax, proration, refunds, invoice PDFs,
billing contacts outside the Org, enforced SSO-only sign-in, SAML, and JIT
provisioning.
