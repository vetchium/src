# Org Signup and Org User Sign-in Requirements

Status: Accepted for implementation

Last updated: 2026-09-27

## 1. Purpose

This document defines the first Org feature: an Org signs up on a tenant by
proving control of one domain, its first superadmin signs in and manages
their own credentials, and the tenant keeps re-proving that the Org still
controls the domain. Org user management, openings, additional domains, and
Org plans beyond a seeded free tier are later features.

It records product decisions and the few engineering decisions that fix
externally visible behavior (DNS record format, timings). Endpoint, table,
and package names are left to the implementation unless stated.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in
this document are to be interpreted as described by BCP 14 when, and only when,
they appear in bold.

## 2. Identity and ownership

- **ORG-ID-001:** An Org is a principal. It **MUST** have an immutable,
  location-neutral UUIDv7 DID that never leaves the backend and private mesh.
  Browser APIs identify an Org by its domain.
- **ORG-ID-002:** The Org's home tenant **MUST** hold the Org's authoritative
  rows, its Org users, and their credentials.
- **ORG-ID-003:** The global directory **MUST** own Org routing (DID to home
  tenant, versioned) and domain ownership (domain to Org DID). It **MUST NOT**
  hold Org names, Org user data, credentials, or verification tokens.
- **ORG-ID-004:** A domain **MUST** be owned by at most one Org at a time across
  all tenants. Uniqueness **MUST** be decided by the global directory, and every
  decision that depends on it **MUST** fail closed when the directory is
  unavailable.
- **ORG-ID-005:** Domain claims are exact. `acme.com` and `eu.acme.com` are
  independent claims that different Orgs **MAY** own; each is proven by its own
  record. Domains use the normalized form of the shared domain contract.
- **ORG-ID-006:** An Org user **MUST** be unique per (Org, email address). The
  same email address **MAY** belong to Org users of different Orgs, which are
  independent accounts.
- **ORG-ID-007:** In this version an Org has exactly one domain, its primary
  domain.
- **ORG-ID-008:** Credential storage **MUST** be separate from the Org user
  identity row, so that a later enterprise single sign-on method can be added
  as another credential kind without reshaping Org users. No SSO mode is built
  now.

## 3. Choosing a home tenant

- **ORG-TEN-001:** Org signup **MUST** reuse Hub signup-region discovery: the
  visitor picks a country, sees the recommended and eligible tenants, chooses
  one, and continues on that tenant's Org portal.
- **ORG-TEN-002:** The region catalog **MUST** carry each region's Org portal
  URL and an advisory Org-signup-enabled flag. A catalog recommendation never
  forces placement.
- **ORG-TEN-003:** The destination tenant owns admission. Its Org signup-enabled
  setting is authoritative and **MUST** be checked at request and completion.
- **ORG-TEN-004:** The chosen country is used only to recommend a tenant. It is
  not stored on the Org.

## 4. Admission

- **ORG-ADM-001:** Signup is self-serve. An Org becomes active as soon as its
  domain is proven; there is no administrator approval.
- **ORG-ADM-002:** Each tenant **MUST** hold a seeded list of blocked signup
  domains covering public mailbox providers (for example `gmail.com`,
  `outlook.com`). A blocked domain and every subdomain of it **MUST** be refused
  at request and completion. Administrator management of this list is deferred.
- **ORG-ADM-003:** A domain already owned by any Org in any tenant **MUST** be
  refused at request time. Ownership takeover is not supported.

## 5. Signup flow

- **ORG-SUP-001:** The requester asks for signup with an email address and the
  Org portal's current UI language. The requester is whoever administers the
  domain for the Org, typically IT staff, and becomes the Org's first
  superadmin. Product text **MUST NOT** imply that this person started or owns
  the company. The claimed domain **MUST** be exactly the email address's
  domain.
- **ORG-SUP-002:** A request creates a pending signup with two independent
  random values: a DNS verification token and a secret signup-link token. The
  link token **MUST** be stored only as a hash.
- **ORG-SUP-003:** The tenant sends two messages in the requested language:
  1. DNS instructions containing the record to publish, written so the
     requester can forward it to whoever manages DNS; and
  2. a private message containing the signup link, marked not for forwarding.
- **ORG-SUP-004:** The request response **MUST NOT** contain either token and
  **MUST** be identical whether or not an Org user or pending signup already
  exists for that address, except for the policy refusals in section 4.
- **ORG-SUP-005:** Any number of pending signups **MAY** exist for one domain
  from different email addresses. A new request from the same email address
  **MUST** supersede that address's earlier pending signup.
- **ORG-SUP-006:** A pending signup expires after a configurable lifetime,
  seven days by default, to allow for DNS changes by a separate team.
- **ORG-SUP-007:** The private link page **MUST** show the domain, the record to
  publish, and the expiry, so the requester can see the instructions again.
- **ORG-SUP-008:** Completing signup requires the link token, the Org display
  name, and a new password. Signup collects no personal name; the UI identifies
  an Org user by email address until a later profile feature.
- **ORG-SUP-009:** The Org display name follows the Hub display-name rules
  (1 to 200 Unicode code points after trimming) and is **not** unique.
- **ORG-SUP-010:** At completion the tenant **MUST** look up the record live. A
  missing or mismatching record **MUST** be refused with a distinct problem that
  leaves the pending signup usable, so the requester can retry after DNS
  propagates.
- **ORG-SUP-011:** The first completion whose record matches claims the domain
  globally. Every other pending signup for that domain **MUST** fail at
  completion with a domain-already-owned problem.
- **ORG-SUP-012:** Completion **MUST** use the reservation and finalization flow
  of `agent-guides/federation.md`: reserve the Org DID and domain globally,
  create a non-loginable local Org and first superadmin, activate globally, then activate
  locally. An uncertain directory outcome returns `202 Accepted` with a durable
  operation ID, and a recovery worker finishes it.
- **ORG-SUP-013:** A completed Org is assigned the seeded free Org plan. The
  requester becomes an active Org user granted `org:superadmin`, and its domain starts
  verified with the proven token recorded as the domain's verification token.
- **ORG-SUP-014:** Completion does not sign the new superadmin in. The portal takes
  them to sign-in with the domain prefilled.

## 6. DNS record

- **ORG-DNS-001:** The record is a TXT record at `_vetchium.<domain>` whose value
  is `vetchium-verify=<token>`. Other TXT values at that name are ignored.
- **ORG-DNS-002:** The token **MUST** be random, at least 128 bits, encoded in a
  DNS-safe alphabet, and reveal nothing about the Org, tenant, or time.
- **ORG-DNS-003:** The record **MUST** stay published for as long as the Org owns
  the domain; periodic re-verification (section 7) checks it.
- **ORG-DNS-004:** A lookup result is one of: *present* (a value matches),
  *absent* (authoritative NXDOMAIN, no TXT data, or no matching value), or
  *inconclusive* (timeout, SERVFAIL, or other resolver error). Only *absent*
  counts as a failure. The resolver address is tenant configuration.
- **ORG-DNS-005:** No environment switch may bypass the lookup. Development and
  CI **MUST** run the same lookup code against a development authoritative DNS
  server whose records tests can write.

## 7. Domain re-verification lifecycle

- **ORG-REV-001:** The workers service **MUST** re-check every owned domain
  weekly, with jitter. The interval, failure threshold, and grace period are
  tenant configuration.
- **ORG-REV-002:** A verified domain becomes *failing* after two consecutive
  *absent* results. One *present* result returns it to *verified* and clears
  the failure count.
- **ORG-REV-003:** An *inconclusive* result is retried with bounded backoff
  within the cycle and does not change the failure count. If a domain has had no
  conclusive result for seven days, the next inconclusive result counts as
  *absent*, so permanently broken DNS cannot hold a domain forever.
- **ORG-REV-004:** While failing, Org users can sign in and use the portal, and
  the portal **MUST** show a banner with the record to restore and a
  check-now action. Each active Org user holding `org:superadmin` **MUST**
  receive one email when the domain enters failing.
- **ORG-REV-005:** After 30 days of continuous failing, the tenant **MUST**
  release the domain from the global directory and mark the Org *suspended*.
  Release uses the idempotent global-command protocol, and the domain becomes
  claimable by any new signup that proves it. Superadmins **MUST** receive one
  suspension email.
- **ORG-REV-006:** A suspended Org's users can sign in, but the portal and API
  **MUST** allow only the session, sign-out, credential-management, and
  domain re-check operations. Every other Org operation **MUST** be refused with
  an Org-suspended problem.
- **ORG-REV-007:** A check-now or scheduled check that finds the record present
  for a suspended Org **MUST** re-claim the domain globally. If no other Org
  claimed it meanwhile, the Org returns to active with the domain verified. If
  another Org owns it, the Org stays suspended.
- **ORG-REV-008:** A check-now request **MUST** require `org:superadmin`. Its
  rate is limited at ingress, not by process-local state.
- **ORG-REV-009:** Every domain state change **MUST** create an audit event in
  the same transaction as the change.

## 8. Sign-in and account security

- **ORG-AUTH-001:** Sign-in takes the Org domain, email address, and password.
- **ORG-AUTH-002:** If the domain belongs to no local Org, the tenant **MUST**
  resolve it in the global directory before checking any password. If another
  tenant owns it, the response is a wrong-tenant problem carrying that tenant's
  Org portal URL from the region catalog, and the portal offers to go there.
  An unknown domain, unknown user, or wrong password **MUST** produce the same
  invalid-credentials response.
- **ORG-AUTH-003:** A disabled Org user **MUST** be refused, using the Hub and
  admin conventions for the disabled-user problem.
- **ORG-AUTH-004:** TOTP is optional and follows the existing Hub and admin
  flow: login challenge, TOTP verification, recovery codes, enrolment, and
  disabling.
- **ORG-AUTH-005:** This iteration includes sign-out, an authenticated session
  endpoint returning the Org display name, domain, domain state, Org state,
  the Org user's email, and effective permissions, forgot and reset password by
  emailed link, change password, and reauthentication.
- **ORG-AUTH-006:** Step-up (recent authentication) is required exactly where
  `agent-guides/authorization.md` requires it: password change, TOTP enrolment
  or disabling, and regenerating recovery codes.
- **ORG-AUTH-007:** Session lifetime is `orgsAPIServer.sessionTTL`. Remembered
  sessions are not offered in this version.
- **ORG-AUTH-008:** Every credential change and sign-in-relevant security effect
  **MUST** follow the existing Hub and admin effects (revoking other sessions on
  password reset, invalidating login challenges, and so on), declared with
  `x-vetchium-security-effects`.

## 9. Permissions and plans

- **ORG-PERM-001:** Org authorization **MUST** follow the admin model in
  `agent-guides/authorization.md`: a permission catalog, implications, direct
  grants, and an effective-permissions view, with the typed vocabulary owned by
  TypeSpec.
- **ORG-PERM-002:** The catalog is seeded with `org:superadmin`. Later features
  add permissions as catalog rows.
- **ORG-PERM-003:** An active Org **MUST** always keep at least one active Org
  user holding `org:superadmin`, enforced inside the writing statement. Nothing
  in this iteration can remove the grant, but the invariant is designed in now.
- **ORG-PLAN-001:** Org plans are seeded configuration identified by plan OIDs,
  byte-identical in every tenant. This version seeds one free plan, assigns it
  at signup, and exposes no plan selection or plan UI.

## 10. Portal

- **ORG-UI-001:** `orgs-ui` provides region discovery, signup request, the
  private-link completion page, sign-in with the wrong-tenant redirect, the TOTP
  step, forgot and reset password, a signed-in shell, the account-security page,
  the failing banner, and the suspended screen.
- **ORG-UI-002:** Auth pages are written in `orgs-ui` from the admin and Hub
  versions for now. Extracting shared form components into `portal-ui` stays in
  `docs/todo.md`.
- **ORG-UI-003:** Every user-visible string ships in every `orgs-ui` locale.

## 11. Explicitly deferred work

- Org user invitation, listing, disabling, and permission management;
- openings and every other hiring feature;
- additional domains, changing the primary domain, and domain transfer or
  takeover;
- Org plan selection, billing, and the enterprise plan with single sign-on;
- administrator management of the blocked-domain list and of Orgs;
- Org terms-of-service acceptance;
- Org profile metadata (logo, description, legal entity details);
- remembered Org sessions; and
- Org migration between tenants.

## 12. Implementation ledger

This checklist is the branch-local resume point for `features/orgs-signup`.
Update it only in the same commit that completes and verifies the
corresponding phase.

- [x] Resolve product decisions and record this specification.
- [x] Add Org signup terms to the glossary.
- [x] Add the Org guide under `agent-guides/` and route to it from
  `CLAUDE.md`.
- [x] Add global-directory Org principals and domain ownership: schema,
  generated queries, coordinator reserve/activate/resolve/release commands, and
  mesh contracts, with database and command tests.
- [x] Add the tenant Org schema: Orgs, domains and verification state, Org
  users, credentials, sessions, login challenges, TOTP, recovery codes, password
  reset, signup requests and completions, permission catalog, plans, blocked
  domains, and the Org email outbox, with constraint tests.
- [x] Add the development authoritative DNS server to development, CI, and Tilt
  orchestration, and the resolver configuration to every tenant config.
- [x] Define the Org signup, authentication, session, and domain TypeSpec
  contracts and problems, with contract tests.
- [x] Implement Org signup in `orgs-api`, including DNS verification and the
  global claim workflow.
- [x] Implement Org sign-in, the wrong-tenant redirect, TOTP, sign-out, session,
  reauthentication, change password, and forgot and reset password.
- [x] Implement workers: signup reconciliation, Org email delivery, domain
  re-verification, failing and suspension notices, release, re-claim, and
  pruning.
- [x] Extend the region catalog and discovery with Org portal URLs and the
  advisory Org-signup flag.
- [x] Build the `orgs-ui` pages in section 10 in every locale.
- [x] Add development seed Orgs with matching development DNS records.
- [x] Add Go handler and worker tests and Playwright API and UI tests.
- [ ] Final review against this specification; move remaining open items to
  `docs/todo.md`.
