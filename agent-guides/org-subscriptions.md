# Org Subscriptions

Applies to Org plans, seats, user management, company identity, logo, and
Google sign-in. Compose with `orgs.md` and `authorization.md`.

## Plans and changes

- Plans are `org-free-tier`, `org-silver-tier`, and `org-gold-tier`, ordered by
  rank. Take entitlements from `typespec/orgs/subscriptions/plans.*` only.
- Every plan change is free and immediate in every environment during
  development. Monthly/annual records a display choice; Free has no interval.
- `orgBilling.offeredPlans` includes Free and matches the portal's compiled
  `orgPlans`. CI `usa1` offers only Free and Silver.
- Display prices belong to the portal until real payments are integrated.
  Mark them as not charged during development. Launch requires real payments
  (`docs/todo.md`).
- Lock the Org row, then read seats in a separate statement. Refuse a target
  whose cap is below seats in use; compute its cap with the current Google
  sign-in choice. An unchanged plan and interval succeeds without a write.
- Save plan, interval, entitlement effects, and audit in one transaction.
  Leaving Gold disables Google sign-in. A target without logos retires the
  logo; Gold to Silver preserves it. Upgrading restores neither setting.
- Keep idempotency across uncertain outcomes. A replay writes no audit event.
- Billing needs `org:manage_billing`; confirm every change with its immediate
  effects and concrete losses. Interval-only changes are not upgrades.

## Seats and users

- A seat is an active user or an unexpired pending invitation, defined once in
  the SQL function `org_seats_in_use`. Disabled users hold none.
- Check the current plan's seat cap under the Org lock on invite, accept,
  and re-enable. A Gold Org with Google sign-in is uncapped.
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
  An expired invitation stays listed and resendable for 30 days before
  housekeeping prunes it; a cancelled or accepted one is pruned at once.
- Scheduling a downgrade checks the target's cap with the Org's Google sign-in
  setting, so a Gold Org with Google sign-in stays uncapped when it only
  changes interval.
- Member lists are server-side: case-insensitive substring search (two
  characters at least), state and permission filters, keyset pagination (100
  at most), and a summary. Bulk operations take at most 100 targets, run in one
  transaction under the lock, and are all or nothing. CSV export is built in
  the browser by paging the list.
- Not built: groups, custom roles beyond the catalog, SCIM, invite links,
  domain auto-join, an Org-facing audit log (`docs/todo.md`).

## Suspended Orgs

- Billing reads stay available; plan changes require an active Org.

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
  address's domain equal the Org domain, the Org still holds the domain
  (`verified`, `failing`, or `releasing`; a released domain proves nothing),
  the address is an existing active user, the Org is on Gold with the switch
  on, and the subject is unlinked or already that user's. The first success links the subject.
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
  immediate plan changes belong in `orgs-subscriptions.spec.ts`. After changing the
  schema, run `make clean` before `make test-stack`, or the tenant databases
  keep their old constraints.
- `make dev-seed` creates a Free, Silver, and Gold Org per region, each with a
  Superadmin, Finance, User manager, and Member user.
