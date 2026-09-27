# Orgs

Applies to Org signup, Org user authentication, Org domain verification and
re-verification, and every future Org feature that builds on them. Compose with
[`federation.md`](federation.md) (global Org routing and domain ownership) and
[`authorization.md`](authorization.md) (the Org permission catalog).

## Required product specification

[`../docs/org-signup.md`](../docs/org-signup.md) is the normative contract for
Org signup, sign-in, and the domain lifecycle. Read it before changing any of
them. The person who signs an Org up is the requester and becomes its first
superadmin; never describe them as a founder or owner in code, text, or tests.

## Identity and ownership

- An Org is a principal with a private UUIDv7 DID. Browser APIs identify an Org
  by its domain and never return the DID.
- The global directory owns Org routing and exact-domain ownership. A tenant may
  refuse early from its own rows, but only the directory decides that a domain
  is free, and every such decision fails closed when the directory cannot
  answer.
- Org users are unique per (Org, email). Sign-in and password reset therefore
  take the domain as well as the email address.
- Credentials live apart from `org_users` (`org_user_passwords`,
  `org_user_totp_credentials`) so another credential kind, such as enterprise
  SSO, can be added without reshaping Org users.

## Domain verification

- Proof of control is a TXT record `_vetchium.<domain>` with value
  `vetchium-verify=<token>`, checked by `backend/internal/dnsverify` against the
  tenant's configured resolver only. Never add an environment bypass;
  development and CI publish real records in the `dns-dev` server under
  `vetchium.test` (`playwright/lib/dev-dns.ts`, `make dev-seed-orgs`).
- Only an authoritative absence counts against a domain. Resolver errors are
  inconclusive, back off, and count as absent only after the configured limit.
- `internal/orgs/domainverification` is the single owner of the lifecycle and
  is shared by the worker and check-now. Guard every state write with the state
  that was read, and queue notices in the same statement as the transition so
  each is sent once per episode.
- Release and re-claim are durable global commands: store the command id with
  the local state change before sending, resend the identical command until the
  directory answers definitely, and suspend locally before releasing globally.

## Suspended Orgs

- A suspended Org's users may sign in, manage their own credentials, read
  my-info, and run check-now. Every other Org route added later must refuse a
  suspended Org with an Org-suspended problem, enforced in middleware from the
  session's Org state, never only in orgs-ui.
- A suspended Org whose released domain was claimed by another Org stays
  suspended until a later feature lets it prove another domain.

## Permissions

- Org authorization mirrors the admin model: catalog, implications, grants,
  effective view, and typed vocabulary in `typespec/orgs/authorization`.
  `org:superadmin` is the only permission so far.
- An active Org must always keep at least one active superadmin. The first
  statement that can remove a grant or disable an Org user must enforce this
  inside the write, like `SetAdminPermissions`.

## Tests

- Give each test its own `uniqueOrgDomain()` and remove everything it created
  with `cleanupOrg`, in every tenant it touched, including global rows.
- CI uses short re-verification timings (2s checks, 8s grace) so lifecycle tests
  run in seconds. `ind1` cannot reach the coordinator in CI; use it to exercise
  fail-closed behavior.
