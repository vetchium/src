# Orgs

Applies to Org signup, Org user authentication, Org domain verification and
re-verification, and every Org feature built on them. Compose with
[`federation.md`](federation.md) (global Org routing and domain ownership) and
[`authorization.md`](authorization.md) (the Org permission model and lockout
invariant).

## Identity and ownership

- An Org is a principal with an immutable UUIDv7 DID that never leaves the
  backend and private mesh. Browser APIs identify an Org by its domain.
- The home tenant holds the Org's authoritative rows, its Org users, and their
  credentials.
- The global directory owns Org routing (DID to home tenant, versioned) and
  domain ownership (domain to DID). Never store Org names, Org user data,
  credentials, or verification tokens there.
- A domain belongs to at most one Org across all tenants. A tenant may refuse
  early from its own rows, but only the directory decides a domain is free, and
  every such decision fails closed when the directory cannot answer.
- Claims are exact: `acme.com` and `eu.acme.com` are independent, each proven
  by its own record. Use the shared normalized domain form (`OrgDomain`).
- An Org has exactly one domain, its primary domain.
- Org users are unique per (Org, email). The same address in two Orgs is two
  independent accounts, so sign-in and password reset take the domain too.
- Keep credentials apart from `org_users` (`org_user_passwords`,
  `org_user_totp_credentials`) so enterprise SSO can be added as another
  credential kind without reshaping Org users.
- The person who signs an Org up is the requester and becomes its first
  superadmin. Never call them a founder or owner in code, text, or tests.

## Home tenant and admission

- The Orgs portal is one global site; signup lists eligible regions on the
  same page as the domain and email fields. Require a region selection before
  entering the domain and email ([`ui.md`](ui.md)).
- Org signup ignores `allowedCountries` (Hub residency policy).
- The region table's `orgSignupEnabled` is advisory. The destination tenant's
  `orgsAPIServer.signup.enabled` is authoritative; check it at request and at
  completion (`org-signup-unavailable`).
- Signup is self-serve: an Org is active once its domain is proven, with no
  administrator approval.
- Refuse a domain in `org_signup_blocked_domains`, or any subdomain of one, at
  request and completion (`org-signup-domain-blocked`). The list is seeded with
  public mailbox providers.
- Refuse at request a domain any Org in any tenant owns
  (`org-domain-already-owned`). There is no takeover.
- Refuse a special-use domain (`orgs.IsSpecialUseDomain`: `test`, `example`,
  `example.com`, `localhost`, and the rest of that list, or a subdomain) at
  request and completion with `org-signup-domain-blocked`, unless the tenant's
  `orgsAPIServer.allowSpecialUseDomains` is true. Only `config/` and
  `config/ci/` set it; production leaves the default `false`.
- `orgs-ui/src/app/regions/<env>.json` mirrors that switch per region
  (`allowSpecialUseDomains`) so the form refuses early;
  `TestPortalRegionTablesMatchCheckedInConfiguration` keeps them equal.

## Signup

- The request takes an email address and the portal's current UI language. The
  claimed domain is exactly the address's domain.
- A request creates a pending signup with two independent random values: the
  DNS token and a secret link token, stored only as a hash.
- Queue two emails in the requested language: DNS instructions written to be
  forwarded to whoever manages DNS, and a private signup link marked not for
  forwarding.
- The request response (`202`) carries neither token and is identical whether
  or not the address already has an Org user or pending signup; only the
  admission refusals above differ.
- Many pending signups may exist for one domain from different addresses. A new
  request from the same address supersedes that address's pending signup.
- A pending signup expires after `orgsAPIServer.signupTTL` (`168h`), long
  enough for a separate DNS team to act.
- The link page (`get-signup-details`) shows the domain, the record, and the
  expiry.
- The link page also looks the record up from the browser through the build's
  DNS-over-HTTPS resolver (`dnsOverHTTPS` in
  `orgs-ui/src/app/regions/<env>.json`: Cloudflare in production, `doh-dev`
  in development and CI), sending no credentials and no referrer. It warns
  when the record is absent and never blocks submission: completion's own
  lookup decides.
- Completion takes the link token, the Org display name, and a new password.
  Collect no personal name; identify an Org user by email address.
- The Org display name follows the Hub display-name rules (1 to 200 code points
  after trimming) and is not unique.
- Look the record up live at completion. Anything but present is refused with
  `org-dns-record-not-found` and leaves the pending signup usable for a retry.
- The first matching completion claims the domain globally; every other
  pending signup for it then fails with `org-domain-already-owned`.
- Complete through the reservation and finalization flow of
  [`federation.md`](federation.md): reserve DID and domain globally, create a
  non-loginable local Org and first superadmin, activate globally, then
  locally. An uncertain directory outcome returns `202` with an `operation_id`,
  and the reconciliation worker finishes it.
- A completed Org gets the seeded plan `org-free-tier`; the requester becomes
  an active Org user granted `org:superadmin`; the domain starts `verified`
  with the proven token as its verification token.
- Completion does not sign in. The portal goes to sign-in with the domain
  prefilled.

## DNS record

- Publish a TXT record at `_vetchium.<domain>` with value
  `vetchium-verify=<token>`. Ignore other TXT values at that name.
- Create tokens with `dnsverify.NewToken`: 128 random bits as 26 lowercase
  base32 characters, revealing nothing about the Org, tenant, or time.
- The record stays published for as long as the Org owns the domain.
- `backend/internal/dnsverify` queries only the tenant's
  `orgDomainVerification.resolverAddress`, never the system resolver. A result
  is `present` (a value matches), `absent` (authoritative NXDOMAIN, no TXT
  data, or no matching value), or `inconclusive` (timeout, SERVFAIL, an answer
  neither authoritative nor recursive, or any other error). Only `absent`
  counts against a domain.
- The only environment bypass is `orgDomainVerification.trustReservedDomains`:
  `dnsverify.Checker` answers `present` without a lookup for `test`, `example`,
  and every `*.test` and `*.example` name. `example.com` is not covered. Only
  `config/` and `config/ci/` set it; production leaves it `false`. The
  browser-side DoH advisory still queries and may warn for those names;
  completion and re-verification ignore it.
- Every other name gets the real lookup. Development and CI publish records in
  the `dns-dev` server under the reserved zones `example`, `example.com`, and
  `test` (`playwright/lib/dev-dns.ts`, `make dev-seed-orgs`). Seeds use
  `<tenant>.example.com`; tests that need a real lookup use the default
  `uniqueOrgDomain()`, a unique `*.example.com`.
- `cmd/doh-dev` (`internal/devdoh`) forwards RFC 8484 GET queries to `dns-dev`
  over TCP for browsers, at `doh.vetchium.localhost` through the edge. It is
  never published or deployed.

## Domain re-verification

`internal/orgs/domainverification` is the single owner of the lifecycle, shared
by the `workers` schedule and check-now.

| `orgDomainVerification` key | Production | Development | CI |
| --- | --- | --- | --- |
| `checkInterval` (plus up to 10% jitter) | `168h` | `10m` | `2s` |
| `failureThreshold` (consecutive absent) | `2` | `2` | `2` |
| `failingGracePeriod` | `720h` | `1h` | `8s` |
| `inconclusiveRetry` (doubles, capped at the interval) | `1h` | `1m` | `1s` |
| `inconclusiveLimit` | `168h` | `1h` | `30s` |

- Domain states are `verified`, `failing`, `releasing`, `released`,
  `reclaiming`; Org states are `active` and `suspended`. The API reports
  `releasing` as `failing` and `reclaiming` as `released`.
- `verified` becomes `failing` after `failureThreshold` consecutive absent
  results. One present result returns `failing` to `verified` and clears the
  count.
- An inconclusive result retries with backoff and leaves the count unchanged.
  Once no conclusive result has arrived for `inconclusiveLimit`, the next
  inconclusive one counts as absent, so broken DNS cannot hold a domain forever.
- While failing, Org users sign in and work normally; the portal shows a banner
  with the record to restore, `release_after`, and check-now.
- Entering `failing` queues one `domain-failing` email to each active Org user
  holding `org:superadmin`.
- After `failingGracePeriod` of continuous failing, move to `releasing` and
  suspend the Org in one statement, queuing one `org-suspended` email to each
  active superadmin; then release globally. The domain becomes claimable by any
  signup that proves it.
- A present result for a `released` domain re-claims it globally. If no other
  Org claimed it, the domain returns to `verified` and the Org to `active`;
  otherwise both stay as they are.
- Check-now (`POST /api/orgs/check-domain`) requires `org:superadmin`, because
  it can re-claim for the whole Org. Rate-limit it at ingress
  ([`backend.md`](backend.md)), never with process-local state.
- Guard every state write with the state that was read, and queue notices in
  the same statement as the transition so each is sent once per episode.
- Write an audit event in the same statement as every domain or Org state
  change.
- Release and re-claim are durable global commands: store the command id with
  the local state change before sending, resend the identical command until the
  directory answers definitely, and suspend locally before releasing globally.

## Suspended Orgs

- A suspended Org's users may sign in, sign out, manage their own credentials,
  read my-info, run check-now, and use the billing routes of
  [`org-subscriptions.md`](org-subscriptions.md). Every other Org route must
  refuse a suspended Org with an Org-suspended problem, enforced by
  `middleware.RequireActiveOrg` from the session's Org state, never only in
  orgs-ui.
- A suspended Org whose released domain was claimed by another Org stays
  suspended until a later feature lets it prove another domain.

## Sign-in and account security

- Sign-in takes the domain, email address, and password.
- Authenticate only in the selected region; never resolve the domain globally
  to locate or hint at a different sign-in region.
- An unknown domain, unknown user, wrong region, and wrong password produce
  the same `org-invalid-credentials`.
- Refuse a disabled Org user with `org-user-disabled`.
- Gold Orgs may also sign in with Google (`sso/google/start` and `complete`),
  which skips Vetchium TOTP; see [`org-subscriptions.md`](org-subscriptions.md).
- TOTP is optional and follows the Hub and admin flow: login challenge, TOTP or
  recovery-code verification, recovery codes, enrolment, and disabling.
- Offer sign-out, my-info, forgot and reset password by emailed link, change
  password, and reauthentication.
- Require step-up exactly where [`authorization.md`](authorization.md) does:
  change password, start TOTP enrolment, disable TOTP, regenerate recovery
  codes.
- Sessions last `orgsAPIServer.sessionTTL`. Do not offer remembered sessions.
- Credential changes carry the Hub and admin security effects: password reset
  revokes every session and pending login; password change revokes every other
  session.

## Permissions and plans

- Org authorization follows the shared model in
  [`authorization.md`](authorization.md). The catalog holds `org:superadmin`,
  `org:manage_users`, and `org:manage_billing`; the superadmin implies the
  other two.
- Org plans are seeded rows identified by plan OIDs, identical in every tenant.
  A new Org starts on `org-free-tier`. Plans, billing, seats, user management,
  the logo, and Google sign-in are in
  [`org-subscriptions.md`](org-subscriptions.md).

## Portal

- The signup request form asks for the domain first, then only the address's
  local part with that domain fixed, and explains the two emails, the TXT
  record, and the private link before submission. The sent state offers no
  way to change the address.
- `orgs-ui` provides region choice, signup request, the private-link
  completion page, sign-in with a mandatory empty region picker, the TOTP
  step, Google sign-in and its callback, forgot and reset password, the
  signed-in shell, account security, the failing banner, and the suspended
  (restore-domain) screen, plus members and invitations, plans and billing,
  Company (name and logo), and Organization security (Google sign-in).
- Show the signed-in email in My account and authorized People administration,
  not in the shell or Overview. Redirect `/settings` to `/company` and
  `/security` to `/account`.
- Ship every user-visible string in every `orgs-ui` locale.

## Tests

- Give each test its own `uniqueOrgDomain()` and remove everything it created
  with `cleanupOrg`, in every tenant it touched, including global rows.
- `ind1` cannot reach the coordinator in CI; use it to exercise fail-closed
  behavior.
