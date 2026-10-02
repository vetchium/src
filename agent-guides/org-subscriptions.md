# Org Subscriptions

Applies to Org plans, subscriptions, billing, seats, user management, the Org
logo, and Google sign-in. Compose with [`orgs.md`](orgs.md),
[`authorization.md`](authorization.md), and
[`hub-subscriptions.md`](hub-subscriptions.md), whose period and concurrency
rules Orgs follow. Nothing here defines Hub plans.

## Plans and entitlements

- Plans are `org-free-tier` (rank 1000), `org-silver-tier` (2000), and
  `org-gold-tier` (3000): seeded rows, identical in every tenant. A higher rank
  includes everything a lower rank allows.
- Entitlements are constants in `typespec/orgs/subscriptions/plans.*` (TypeSpec
  extension, Go, TypeScript). Never restate one elsewhere.

  | | Free | Silver | Gold |
  | --- | --- | --- | --- |
  | Users (seats) | 5 | 50 | 1000, none with Google sign-in on |
  | Openings per rolling 365 days | 25 | 250 | 2500 |
  | Org logo | no | yes | yes |
  | Google sign-in | no | no | yes |
  | Ticket-based support | no | no | yes (not built) |

- `orgBilling.offeredPlans` in each tenant's config must include
  `org-free-tier`; `orgs-ui` compiles the same list as `orgPlans` in
  `orgs-ui/src/app/regions/<environment>.json`, and
  `TestPortalRegionTablesMatchCheckedInConfiguration` keeps them equal.
- The portal owns the simulated display prices (flat per plan and interval,
  annual is eleven months, tax included, labelled "Introductory pricing").
  Gold's comparison lists Ticket-based support and MCP support as "Coming
  soon"; neither has an entry point.
- Payments are simulated everywhere: one saved card per Org, either
  `simulated-succeeds` or `simulated-declines`. No real card data exists.

## Changes and periods

- An upgrade (higher rank, or the same plan going monthly to annual) charges at
  once and starts a new period. A refusal (no card, a decline) changes nothing.
  A downgrade or cancellation is scheduled for period end. Choosing the current
  plan and interval clears a schedule.
- `backend/internal/orgs/billing.Advance` is the only period-end rule, with
  `Decide`, `Pay`, and `KeepSet` beside it. It is pure and moves one step at a
  time. Requests and the worker persist due transitions through
  `billingdb.Save` (`SaveOrgSubscription`), one statement that writes the
  state, the folded invoice changes, and the audit events. A request persists a
  due transition even when it then refuses (`CommittedFailure`). Reads compute
  in memory and write nothing.
- Lock the `orgs` row `FOR UPDATE` before any billing, seat, or permission
  decision (`LockOrgSubscriptionForChange`, `LockOrgSeatPolicy`,
  `LockOrgForInvitation`, `LockOrgForGoogleSignIn`). Read seats in a separate
  statement after the lock; a function inside the locking statement counts
  against the older snapshot.
- Workers claim with `FOR NO KEY UPDATE SKIP LOCKED`, one Org per transaction.

## Failed payment

- A failed renewal (or no card) advances the period, opens an invoice with
  `due_at = period_end + gracePeriod`, and marks the Org past due. Service
  continues on the paid plan. The saved card is retried at the configured
  offsets, measured from the period boundary.
- While past due, a billing holder may pay the invoice, replace or remove the
  card, and read billing; choosing a plan is refused with
  `org-billing-past-due`.
- At the deadline, in one transaction: the invoice is voided, the Org drops to
  `org-free-tier` with its schedule cleared, every invitation is cancelled,
  active users beyond the keep set are disabled with reason `nonpayment` and
  their sessions revoked, the logo is removed, and Google sign-in is turned
  off. Emails go to the disabled users and the kept billing holders. Paying
  afterwards is a fresh upgrade.
- The keep set is five active users: `org:superadmin` holders first, then
  `org:manage_billing` holders, then the oldest `created_at`, then
  `org_user_id`. It always keeps a superadmin.
- Re-enabling is manual, one user at a time, within the cap. Nothing re-enables
  after payment. A user disabled for nonpayment who signs in gets
  `org-user-disabled-nonpayment`.
- Warnings: billing holders are emailed on every failed charge and at the
  `dueWarningLeads` before the deadline; a rank-lowering schedule warns at
  `downgradeWarningLeads` (banner in the final 7 days). Every signed-in user
  sees the past-due banner, carried by `my-info`.

  | `orgBilling` key | Production | Development | CI |
  | --- | --- | --- | --- |
  | `gracePeriod` | `336h` | `1h` | `12s` |
  | `retryOffsets` | `72h`, `168h`, `264h` | `10m`, `20m`, `40m` | `3s`, `6s`, `9s` |
  | `dueWarningLeads` | `168h`, `72h`, `24h` | `30m`, `15m`, `5m` | `9s`, `6s`, `3s` |
  | `downgradeWarningLeads` | `168h`, `24h` | same | same |
  | `checkInterval` | `1m` | `10s` | `1s` |

  `usa1` offers only Free and Silver in CI, to exercise `org-plan-not-offered`.
  Every duration is a config key; parse each without a silent default.
- The CI worker acts every second. A test that needs a stable past-due state
  sets it in SQL and asserts what holds whichever of request or worker acts.

## Seats and users

- A seat is an active user or an unexpired pending invitation, defined once in
  the SQL function `org_seats_in_use`. Disabled users hold none.
- The cap is the lower of the current and any scheduled plan's
  (`orgusers.SeatLimit`), so a transition never finds excess users. Invite,
  accept, and re-enable check it under the Org lock. Scheduling a downgrade
  while seats exceed the target cap is refused with
  `org-user-limit-exceeds-target`.
- Roles are permissions: `org:manage_users` and `org:manage_billing` are
  catalog permissions, and `org:superadmin` implies both. Billing is separate
  from member administration.
- Delegation: a `org:manage_users` holder may invite, list, disable, and
  re-enable users and grant or revoke `org:manage_users`. Only a superadmin may
  grant or revoke `org:superadmin` or `org:manage_billing`, or disable or
  re-enable a superadmin; the refusal names the target
  (`org-superadmin-required`). Changing grants needs step-up; inviting and
  disabling do not.
- No one disables themselves or changes their own grants
  (`org-self-change-forbidden`). Grant changes apply on the user's next request
  because the guard reads the effective view each time. Disabling revokes every
  session at once. Users are never deleted.
- Identify an Org user on the wire by email address within the Org. Invitees
  must be on the Org's domain; invitations last `orgsAPIServer.invitationTTL`.
- Member lists are server-side: case-insensitive substring search (two
  characters at least), state and permission filters, keyset pagination (100
  at most), and a summary. Bulk operations take at most 100 targets, run in one
  transaction under the lock, and are all or nothing. CSV export is built in
  the browser by paging the list.
- Not built: groups, custom roles beyond the catalog, SCIM, invite links,
  domain auto-join, an Org-facing audit log (`docs/todo.md`).

## Suspended Orgs

- A suspended Org keeps billing reads, `set-payment-method`,
  `remove-payment-method`, and `pay-invoice` besides the account routes of
  [`orgs.md`](orgs.md). Compose `middleware.RequireActiveOrg` on every other
  route. The worker bills suspended Orgs too: they can pay.

## Logo

- Silver and above. The pipeline is the Hub profile picture's
  ([`object-storage.md`](object-storage.md)): staged upload with an
  idempotency-ledger row, HMAC object id, 30 s bounded Put, activation that
  retires the old object, and a worker that deletes retired bytes after a one
  minute grace.
- PNG or JPEG, 128 to 4096 pixels per side, at most 2 MiB. Removal is open to
  every plan. `SaveOrgSubscription` queues the object for deletion whenever
  the new plan lacks logos; a later upgrade does not restore it.

## Google sign-in

- Gold only, switched on by a superadmin (step-up) in settings. Turning it off
  runs under the Org lock and is refused with `org-user-limit-exceeds-target`
  while seats exceed the plain Gold cap. Leaving Gold clears it in the
  transition statement, and a CHECK keeps the column false off Gold.
- `backend/internal/oidc` runs the authorization code flow with PKCE and a
  nonce against one provider (go-oidc and oauth2). The credential table is
  `org_user_sso_identities (provider, subject)`; the tenant config is
  `orgsAPIServer.googleSignIn` (`issuer`, `clientID`, `clientSecretFile`,
  `redirectURI`, and `discoveryURL` only for the development provider).
  Without the block a tenant answers `org-sso-not-available`.
- `sso/google/start` answers alike for every domain. `sso/google/complete`
  succeeds only when the state is unused and unexpired, the ID token verifies
  (issuer, audience, expiry, nonce), `email_verified` is true, `hd` and the
  address's domain equal the Org domain, the address is an existing active
  user, the Org is on Gold with the switch on, and the subject is unlinked or
  already that user's. The first success links the subject.
  `CreateOrgSSOSession` re-checks all of it in the statement that links and
  signs in.
- Every refusal before the user is a known member is `org-sso-sign-in-failed`;
  the reason is logged only. A disabled user gets the password-login problems;
  a suspended Org may sign in. There is no auto-provisioning.
- It skips Vetchium TOTP: the Workspace administrator's 2-Step Verification is
  the second factor. Password sign-in still requires TOTP, and every user keeps
  a password for fallback and step-up.
- Development and CI run `cmd/oidc-dev`, a real provider without a user
  interface (`internal/oidc/mock`); the test names the account with
  `login_hint` and may override `hd`, `sub`, and `email_verified`. There is no
  code bypass, and it is never in `deploy/`. Production setup is in
  `deploy/README.md`.

## Openings quota

- Openings are not built. `internal/orgs/entitlements.OpeningQuota` and its
  comment state the counting rule: count Openings published in the last 365
  days whatever their state now, check the count in the publishing statement
  under the Org lock, and refuse a plan that cannot publish another.

## Audit and tests

- Every state change writes an audit event in its own transaction.
- Plan, seat, and permission cases belong in `playwright/api/orgs-*.spec.ts`;
  the end-to-end lifecycle is `orgs-billing-worker.spec.ts`. After changing the
  schema, run `make clean` before `make test-stack`, or the tenant databases
  keep their old constraints.
- `make dev-seed` creates a Free, Silver, and Gold Org per region, each with a
  Superadmin, Finance, User manager, and Member user.
