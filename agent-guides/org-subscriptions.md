# Org Subscriptions

Applies to Org plans, seats, user management, company identity, and logo.
Compose with `orgs.md` and `authorization.md`.

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
  whose cap is below seats in use. An unchanged plan and interval succeeds
  without a write.
- Save plan, interval, entitlement effects, and audit in one transaction.
  A target without logos retires the logo; Gold to Silver preserves it.
  Upgrading does not restore the logo.
- Keep idempotency across uncertain outcomes. A replay writes no audit event.
- Billing needs `org:manage_billing`; confirm every change with its immediate
  effects and concrete losses. Interval-only changes are not upgrades.

## Seats and users

- A seat is an active user or an unexpired pending invitation, defined once in
  the SQL function `org_seats_in_use`. Disabled users hold none.
- Check the current plan's seat cap under the Org lock on invite, accept,
  and re-enable.
- Roles are permissions: `org:manage_users` and `org:manage_billing` are
  catalog permissions, and `org:superadmin` implies both. Billing is separate
  from member administration.
- Delegation: a `org:manage_users` holder may invite, list, disable, and
  re-enable users and grant or revoke `org:manage_users`. Only a superadmin may
  grant or revoke `org:superadmin`, `org:manage_billing`, `org:manage_ai`, or
  `org:approve_openings`, or disable or re-enable a superadmin; the refusal
  names the target (`org-superadmin-required`). Changing grants needs step-up;
  inviting and disabling do not.
- No one disables themselves or changes their own grants
  (`org-self-change-forbidden`). Grant changes apply on the user's next request
  because the guard reads the effective view each time. Disabling revokes every
  session at once. Users are never deleted.
- Identify an Org user on the wire by email address within the Org. Invitees
  must be on the Org's domain; invitations last `orgsAPIServer.invitationTTL`.
  An expired invitation stays listed and resendable for 30 days before
  housekeeping prunes it; a cancelled or accepted one is pruned at once.
- Member lists are server-side: case-insensitive substring search (two
  characters at least), state and permission filters, keyset pagination (100
  at most), and a summary. Bulk operations take at most 100 targets, run in one
  transaction under the lock, and are all or nothing. CSV export is built in
  the browser by paging the list.
- Every people picker (hiring team, interviewers, provider interviewers)
  uses `suggest-org-users` through `OrgUserInput` or `OrgUsersSelect`
  (`orgs-ui/src/features/users/OrgUserPickers.tsx`); never add a picker
  endpoint per screen. Any user of an active Org may call it, with no
  permission: it answers active users whose address contains the query,
  prefix matches first, at most 20.
- Not built: groups, custom roles beyond the catalog, SCIM, invite links,
  domain auto-join, an Org-facing audit log (`docs/todo.md`).

## Suspended Orgs

- Billing reads stay available; plan changes require an active Org.

## Company identity

- Company name and logo edits require a superadmin and an active Org.
- Normalize and validate the name as at signup (1–200 Unicode code points).
  Lock the Org and audit a changed name in the same transaction; omit its
  value from the audit payload. An unchanged name writes no event.

## Logo

- Silver and above. The pipeline is the Hub profile picture's
  ([`object-storage.md`](object-storage.md)): staged upload with an
  idempotency-ledger row, HMAC object id, 30 s bounded Put, activation that
  retires the old object, and a worker that deletes retired bytes after a one
  minute grace.
- PNG or JPEG, 128 to 4096 pixels per side, at most 2 MiB. Removal is open to
  every plan. `SaveOrgSubscription` queues the object for deletion whenever
  the new plan lacks logos; a later upgrade does not restore it.

## Listings

- `allows_listings` is a plan entitlement (Silver and Gold). It gates
  publishing marketplace Listings and receiving engagement proposals
  ([`marketplace.md`](marketplace.md)).

## AI credits

- `allows_ai` and `ai_credits_per_month` are plan entitlements (Gold only).
  Their effect on AI operations, grants, and purchases is in
  [`ai.md`](ai.md); a downgrade never removes purchased credits.

## Openings quota

- `internal/orgs/entitlements.OpeningQuota` and its comment state the
  counting rule; [`openings.md`](openings.md) says where it applies.

## Audit and tests

- Every state change writes an audit event in its own transaction.
- Plan, seat, and permission cases belong in `playwright/api/orgs-*.spec.ts`;
  immediate plan changes belong in `orgs-subscriptions.spec.ts`. After changing the
  schema, run `make clean` before `make test-stack`, or the tenant databases
  keep their old constraints.
- `make dev-seed` creates a Free, Silver, and Gold Org per region with
  Superadmin, Finance, User manager, Recruiter, and Hiring approver users.
  Silver and Gold also have a Member; Free uses its five seats.
