# Hub Signup and Locality

Applies to Hub signup, signup-region discovery, global identity claims, and
profile locality. Compose it with `federation.md` plus the backend, database,
TypeSpec, UI, and Playwright guides for the layers being changed.

## Signup ownership

- A visitor chooses resident country, language, and an eligible account tenant.
  A catalog recommendation is only a recommendation; it never forces placement.
- Carry only country and language to the destination portal. Collect email,
  display name, and other personal signup data at the destination. Verification
  links are issued and redeemed by that tenant.
- The destination tenant owns admission. Its signup-enabled setting and active,
  admin-managed email-domain allowlist are authoritative. Check the local
  allowlist in SQL at both initiation and completion, and recheck region
  eligibility at completion. Approval in another tenant never counts, and
  there is no any-domain bypass.
- A policy refusal creates no Hub user. A replay of an already completed
  idempotent request retains its original result rather than applying current
  policy retroactively.
- The same email may identify independent accounts in different tenants. Never
  infer an account merge or cross-tenant authorization from an equal email
  address. Global identity comes only from the DID directory.

## Identity and profile locality

- A Hub user's DID is an immutable, location-neutral UUIDv7. It is private,
  never reused, and survives a future tenant move. It never leaves the backend
  and the private mesh: no portal response, stored browser session, or UI shows
  it. Browser APIs identify a Hub user by handle, and the backend maps a handle
  to its DID when it needs one.
- Handles are public, permanent, and globally unique. A handle is an
  eight-character prefix, a hyphen, and an 11-character random Crockford-base32
  suffix; the suffix must reveal neither the DID nor creation time. The prefix
  is the first eight ASCII letters and digits of the display name, skipping any
  other character and padded with random digits when the name has fewer. Only a
  name with no ASCII letter or digit uses `user` plus random digits. Do not
  transliterate. The global directory, not a tenant-local constraint, decides
  uniqueness. A collision retries with a fresh suffix without consuming the
  signup request.
- Signup uses the provisioning reservation/finalization flow in
  `federation.md`: reserve the DID, handle, and home tenant globally; create a
  non-loginable local row; activate the global route; then activate the local
  account and mint a session. Directory unavailability fails closed.
- The permanent handle URL is `https://vetchium.com/u/<handle>`. A paid alias is
  an alternate address and never replaces the canonical handle or QR payload.
- Initialize preferred job countries from residence. Later residence changes
  do not change job preferences, home tenant, or identity. An empty preference
  means no country filter.

## Account email changes

- The account email is the sign-in identifier, so changing it is a credential
  change. Request a code for the new address only from a recently
  authenticated session, and accept it only from that same session.
- The email-domain allowlist gates signup only. After admission a user may
  move to any address, including a personal one, so an email change never
  consults the allowlist.
- Answer an address that already belongs to an account exactly like any other,
  but send it no code, so the response cannot test whether an address is
  registered. The unique account-email constraint decides the race with a
  concurrent signup.
- A confirmed change revokes the user's other sessions, pending login
  challenges, and password reset links, which were delivered to the old
  address, and notifies the old address. Audit that the address changed, never
  the addresses themselves.

## Region discovery

The discovery path is browser to tenant Hub API to tenant mesh API to the
global coordinator.

- Region discovery remains deployment-catalog behavior. The same global service
  may also front the separate global PostgreSQL directory defined in
  `federation.md`; catalog fallback never substitutes for an identity-routing or
  uniqueness decision.
- Hub and mesh processes each use a mounted, versioned local catalog. Bound
  remote calls with timeouts and fall back to the caller's local catalog so a
  cold start and an outage do not block discovery.
- Treat catalogs as deployment configuration, not live replicated policy.
  Restart to reload them. A stale recommendation may reach a tenant that then
  refuses signup; destination admission remains authoritative.
- `allowedCountries: []` means every country. Exclude disabled regions, reject
  unknown tenant IDs at admission, and keep tenant IDs open strings rather than
  a four-tenant enum.
- Paginate catalog results by tenant-ID keysets bound to the country filter and
  catalog contents.

## Federation and migration

Federated routing and migration use `federation.md`. In addition:

- Follow edges belong to the follower; mutual connections need a deterministic
  owner. Keep applications, interviews, and offers with the hiring Org.
- A destination rechecks its active email-domain allowlist and must offer the
  user's plan before handover. Resolve destination email collisions explicitly;
  equal emails never merge accounts. Preserve the DID and permanent handle.
- Derive expansion reports from aggregate tenant counts by residence and
  activity. Do not centralize individual business data for reporting.

Migration billing choices and other deliberately unresolved work belong in
[`../docs/todo.md`](../docs/todo.md), not in inferred implementation policy.
