# Hub Signup and Locality

Applies to Hub signup, signup-region discovery, profile location, federation,
and principal migration. Compose it with the backend, database, TypeSpec, UI,
and Playwright guides for the layers being changed.

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
  infer a global account, account merge, or cross-tenant authorization from an
  equal email address.

## Identity and profile locality

- A Hub user's DID is an immutable, location-neutral UUIDv7. It is private,
  never reused, and survives a future tenant move.
- Handles are public and allocated locally without a coordinator. Keep the
  readable prefix and random Crockford-base32 suffix; the suffix must reveal
  neither the DID nor creation time. Let the database unique constraint decide
  collisions, retry with a fresh suffix, and do not consume the signup request
  on a collision.
- Initialize preferred job countries from residence. Later residence changes
  do not change job preferences, home tenant, or identity. An empty preference
  means no country filter.

## Region discovery

The discovery path is browser to tenant Hub API to tenant mesh API to the
global coordinator.

- The coordinator is an authenticated private-mesh service containing only
  deployment catalog data. It has no database and must never become an account
  directory or hold profiles, connections, hiring data, or credentials.
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

## Future federation and migration

Federated account routing and principal migration are not implemented. Before
adding them, preserve these boundaries:

- Add a minimal DID-to-home-tenant directory with routing versions and durable
  local caches. Ordinary operations must survive the global service being down.
- Give every business aggregate one authoritative tenant. Follow edges belong
  to the follower; mutual connections need a deterministic owner. Represent a
  remote principal by DID, not by a required local account row.
- Keep applications, interviews, and offers with the hiring Org. Move
  user-owned records while preserving access to active Org-owned workflows.
- Copy state and pending work, fence source writes, verify the copy, and only
  then perform a versioned routing handover. Retain source authority during a
  global outage and preserve forwarding information for stale callers.
- Transfer idempotency and security state, re-encrypting secrets as needed,
  plus outboxes and scheduled work. Migration cleanup must not reuse
  account-deletion cascades.
- Recheck the destination tenant's active email-domain allowlist at final
  admission, and require it to offer the user's subscription plan before
  handover. Revocation rejects the move without losing source data. Resolve
  destination email collisions explicitly; equal emails never merge accounts.
  Preserve the DID and handle.
- Derive expansion reports from aggregate tenant counts by residence and
  activity. Do not centralize individual business data for reporting.

Migration billing choices and other deliberately unresolved work belong in
[`../docs/todo.md`](../docs/todo.md), not in inferred implementation policy.
