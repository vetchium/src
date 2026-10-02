# Federation

Applies to global identity and routing, the global directory and its claims,
the identity digest key, tenant-to-tenant commands, cross-tenant projections,
principal migration, and every workflow whose authoritative data lives outside
the caller's tenant. Deployment, certificates, and networks are in
[`mesh-topology.md`](mesh-topology.md); Hub signup and account email changes
are in [`hub-signup.md`](hub-signup.md).

## Trust

- Private reachability is not authentication. Every `mesh-api` has a distinct
  client certificate from the Vetchium private CA, and mesh and global services
  require HTTPS with mutual TLS. Neither WireGuard nor mTLS replaces handler
  authorization.
- Derive the calling tenant from the verified client certificate, never from a
  body, header, source IP, DNS name, or caller-supplied tenant id.
- A tenant mesh-api certificate carries exactly one URI SAN
  `spiffe://mesh.vetchium.com/tenant/<tenant-id>/mesh-api`. Only a chain the
  configured private CA accepts may populate the caller-tenant context.
- A mesh HTTPS listener requires a private-CA client certificate in the
  handshake. The coordinator healthcheck certificate identifies a health
  workload: it may reach `/healthz`, never a tenant identity or directory
  operation.
- A tenant mesh API has two listeners. The relay on `8080` accepts only health
  checks or the mounted bearer credential of its own tenant's API servers and
  workers. The peer listener on `8443` requires a private-CA client
  certificate and applies certificate-derived identity middleware to every
  route. Never register a peer endpoint on the relay mux or expose a relay
  credential to a peer.
- The browser talks only to its authenticated home tenant. Browser-facing
  APIs and portals never receive mesh or coordinator credentials, and
  directory endpoints never appear on portal ingress. Tenant Hub APIs and
  workers call their local mesh API with the relay credential; only the mesh
  API calls the coordinator, with the tenant's mTLS identity.
- The coordinator and its database are mesh-internal.
  `https://vetchium.com/u/<handle>` is a public navigation entry point, not
  access to the global database.
- The trust model handles crash-stop failures, timeouts, partitions, retries,
  duplicates, and reordering. It does not attempt Byzantine fault tolerance
  between Vetchium-operated tenants.

## Global directory

- One global PostgreSQL database owns principal routing and global uniqueness.
  For a Hub user it stores only the DID, permanent handle, optional paid alias,
  home tenant, routing version, lifecycle state, account-email digest claims,
  and the timestamps those invariants need. For an Org it stores only the DID,
  home tenant, routing version, lifecycle state, and owned domains
  ([`orgs.md`](orgs.md)).
- Never store credentials, raw email addresses, profile fields, work-email
  evidence, subscription state, hiring data, or other tenant-owned business
  data there.
- Handles are globally unique, permanent, never reused. A paid alias is a
  separate global claim that may be released and immediately reassigned.
  Handle and alias syntax are disjoint so one `/u/<slug>` lookup is
  unambiguous.
- A global route is versioned. A cache may choose a destination but never
  authorizes a caller. Re-resolve on expiry, on relocation responses, and
  before a security-sensitive homing decision.
- Local authoritative reads continue during a global outage. A remote read may
  use an unexpired cached route, otherwise it fails within a configured
  timeout. Every uniqueness decision fails closed when the directory is
  unavailable.
- Every directory mutation runs inside `runCommand`
  (`backend/internal/globaldirectory`), which writes the command ledger,
  `global_audit_events`, and `global_outbox_events` in the same transaction.
  Only the reaper and prune jobs write outside a command, and they audit in the
  same statement.
- Every command checks the caller tenant against the principal's
  `home_tenant_id` (`directory-caller-tenant-mismatch`) and requires an active
  principal, unless its rule says otherwise.

## Identity digest key

- A Hub account email is globally unique through a keyed digest, so the
  coordinator never holds a reversible address. A plain hash would be
  dictionary-reversible.
- **GU-KEY-003** `identitydigest.Key` derives its root as
  `sha256("vetchium-identity-digest-root\x00" + secret)`, with no tenant id. A
  digest is `HMAC-SHA256(root, "vetchium/identity-digest/v1/" + namespace + "\x00" + Normalize(address))`;
  the only namespace is `hub-account-email`. Give any future purpose its own
  namespace so its digests never correlate with account emails.
- `Normalize` is `lower(btrim(address))` exactly as the database `CHECK`s
  enforce it: trim only ASCII space, no Gmail dot or plus folding. Keep Go
  byte-identical to the database.
- Compute digests only in Go. The key never reaches PostgreSQL.
- **GU-KEY-002** Mount `identity_digest_key` only into each tenant's `hub-api`
  and `workers`, never orgs-api, admin-api, mesh-api, mcp-server, or the
  coordinator. `backend/cmd/global-coordinator` and `backend/cmd/mesh-api`
  must not even transitively import `backend/internal/identitydigest`
  (`backend/internal/architecture`). A package reachable from
  `backend/internal/routes` declares its own `AccountEmailDigester` interface;
  only the `hub-api` and `workers` mains construct the concrete key.
- **GU-CFG-002** `hub-api` passes the key to `hub.Server`, the signup
  completion service, and the email-change service; `workers` passes it to the
  signup and email-change recovery jobs.
- `appconfig.IdentityDigestSecret()` reads `IDENTITY_DIGEST_KEY_FILE`
  (default `/run/secrets/identity_digest_key`) and rejects an empty file.
- The secret is identical in every region — a different key silently breaks
  uniqueness. Production deploy requires the operator-supplied
  `IDENTITY_DIGEST_KEY_FILE` and never generates it per region.
- **GU-KEY-004** `Key.ID()` is the lowercase hex of the first 8 bytes of
  `HMAC-SHA256(root, "vetchium/identity-digest/key-id/v1")`. Every directory
  request carrying a digest also carries `digest_key_id`. The coordinator
  holds only that id (`identityDigestKeyId` in its config) and rejects a
  mismatch with `directory-digest-key-mismatch`.
- No audit payload, outbox payload, mesh payload log, `last_error`, or
  structured log contains an address, digest, or verification code. Global
  audit `entity_id` for claim rows is the Hub user DID, never the digest.
- Verified professional (work) emails are not globally unique; they keep their
  local one-verified-address-per-user-per-domain constraint. An address may be
  one user's account email and anyone's professional email. Duplicate
  verification by unrelated accounts is an abuse-detection concern
  ([`../docs/todo.md`](../docs/todo.md)), not a directory invariant.

## Account email claims

- `hub_account_email_claims` is keyed by the 32-byte digest, with state
  `provisioning`, `active`, or `pending_change`. A user has at most one
  current (`provisioning` or `active`) claim and at most one `pending_change`
  claim; a `pending_change` claim always names its reservation's `change_id`.
- The claim trigger allows only `provisioning → active` (principal already
  active), `pending_change → active` (no other current claim for the user),
  and deletion, and never changes `hub_user_did` or `email_digest`.
- `hub_account_email_change_reservations` is keyed by the tenant's change id
  with state `reserved`, `cancelled`, or `finalized`; only `reserved` may move,
  to either terminal state. A `cancelled` row stays as a tombstone that fences
  a late reserve; only a tombstone from an abandon-before-reserve has a null
  digest.
- Email-change commands write outbox events on the
  `hub_account_email_change_reservation` aggregate (version 1 when written, 2
  after its terminal transition), including stale reservations a reserve
  cancels. Their audit payload is `{schema_version, change_id, state,
  cancelled_change_ids}`, never a digest.

| Problem type | Status | Meaning |
| --- | --- | --- |
| `directory-email-claim-conflict` | 409 | Another claim holds the digest; distinct from `directory-claim-conflict` (handle) |
| `directory-digest-key-mismatch` | 409 | `digest_key_id` differs from the configured id |
| `directory-reservation-expired` | 409 | Reserve arrived after `not_after` by the coordinator's clock; no side effects |
| `directory-reservation-cancelled` | 409 | Reserve for an abandoned change id; no side effects |

- **GU-DIR-001** `resolve-hub-account-email` takes `{email_digest,
  digest_key_id}` and returns only `home_tenant_id` for a `provisioning` or
  `active` claim, else 404. Never return the DID.
- **GU-DIR-002** `reserve-hub-principal` carries `account_email_digest` and
  `digest_key_id` and inserts a `provisioning` claim in the same statement as
  the principal and handle. Insert the claim before the handle so an email
  conflict returns `directory-email-claim-conflict` and never burns a
  handle-rotation attempt.
- **GU-DIR-003** `activate-hub-principal` activates the principal's
  `provisioning` claim in the same statement.
- **GU-DIR-004** `reserve-hub-account-email-change` (`{command_id, change_id,
  hub_user_did, new_email_digest, not_after, digest_key_id}`), under a lock on
  the reservation row: a reservation owned by another user or the same change
  id with another digest is `directory-state-conflict`; `not_after` passed
  (checked even when the row is missing) is `reservation-expired`; a tombstone
  is `reservation-cancelled`; the same reservation again succeeds unchanged.
  Otherwise, in one statement, cancel the user's other `reserved` reservation
  and delete its claim — the tenant allows one live change per user, so it is
  stale — then insert the reservation and its `pending_change` claim. A digest
  held by anyone, including this user's current claim, is
  `directory-email-claim-conflict` with no reservation row.
- **GU-DIR-005** `finalize-hub-account-email-change` (`{command_id, change_id,
  hub_user_did}`) requires a `reserved` reservation owned by the user, then in
  one statement deletes the user's `active` claim, promotes the
  `pending_change` claim, and marks the reservation `finalized`. Already
  `finalized` succeeds unchanged; `cancelled` or missing is
  `directory-state-conflict`.
- **GU-DIR-006** `abandon-hub-account-email-change` (`{command_id, change_id,
  hub_user_did, not_after}`, deliberately no digest): `reserved` becomes
  `cancelled` and its claim is deleted; a missing reservation gets a
  `cancelled` tombstone with the given `not_after` and a null digest, so
  whichever of a racing reserve and abandon lands first, the address ends up
  unclaimed; `cancelled` succeeds unchanged; `finalized` is
  `directory-state-conflict` (a tenant bug). Audit only when a row changed.
- **GU-DIR-010** The provisioning reaper deletes an expired principal's claim
  in the same statement and records `email_claim_released` in that
  principal's audit event, naming its home tenant as actor. An hourly
  coordinator job prunes terminal reservations once `not_after` is more than
  seven days past, in bounded batches with one summary audit event per home
  tenant. Never reap `pending_change` claims by time; they leave only through
  finalize or abandon.

## Authority

- Every aggregate has exactly one authoritative tenant. Profiles and user-owned
  settings belong to the Hub user's home tenant; applications, candidacies,
  interviews, and offers to the opening owner's tenant.
- A remote principal is represented by its DID and a non-authoritative routing
  hint, never a required shadow account row.
- The authoritative tenant validates business rules, authorization, state, and
  concurrency. Routing evidence and an authenticated calling tenant never
  substitute for business authorization.
- Reads may be proxied synchronously. Writes are commands to the aggregate's
  authority and follow the durable protocol below.

## Durable cross-tenant commands

Use one generic operation ledger at the initiating tenant and one generic
command-result ledger at the authority; no per-feature reliability protocol.

1. Require an idempotency key for every resource-creating request and every
   cross-tenant side effect.
2. Before the first network call, the initiating tenant commits the
   idempotency row and a pending operation holding: a pre-minted
   operation/command id, any pre-minted resource id, the authoritative
   principal DID, the initiating principal type and id (for status
   authorization), a canonical request digest, and the replayable logical
   payload. Never store a bearer secret in the payload. The initiating
   principal need not own the aggregate.
3. Resolve the authoritative tenant, then send the command with the same
   command id and correlation id on every attempt.
4. The authority rejects a reused command id with a different digest and
   replays the stored result for the same digest. When a command names a
   sub-resource by a caller-minted id (a reservation or change id), check that
   the locked row belongs to the principal the caller proved it owns.
5. On first execution, the authority commits the business mutation, audit
   event, replayable result, and outgoing events in one local transaction.
6. A definite success or deterministic `4xx` resolves the initiating
   operation. If the command was sent but its outcome is unknown, return `202
   Accepted` with the operation id. If no command was issued because routing or
   connection setup failed, return a retryable `503` or `504`.
7. A recovery worker re-resolves the owner and re-drives the identical command
   until it obtains the stored outcome. It selects due work by
   `next_attempt_at` and records the attempt, with backoff, before sending, so
   operations stuck on an unreachable authority never hold the front of every
   batch.

- Never hold a database transaction open across a directory or mesh call,
  including inside an idempotency helper's callback: resolve first, then open
  the transaction.
- For uncertain Hub browser outcomes, return HTTP `202` with
  `Vetchium.Hub.Operations.PendingOperation`. The user polls
  `/api/hub/operations/status` (`pending`, `succeeded`, `failed`) and replays
  the original request with its original idempotency key for the typed result.
  The status endpoint authorizes operation ownership and returns no payloads or
  secrets. Reuse this shape for remote job applications rather than a
  per-feature polling protocol.
- Never use PostgreSQL prepared transactions, an HTTP prepare/commit protocol,
  or a cross-database transaction — they couple availability and leave
  prepared work needing operator recovery.

## Transactional outbox and inbox

- An outbox carries effects after an authoritative commit: projections,
  notifications, object deletion, cache invalidation. Enqueuing an event does
  not prove a remote command succeeded and does not replace the command
  ledger.
- Insert the outbox event in the same transaction as the state change. Deliver
  at least once with bounded exponential backoff and alerting on sustained
  failure.
- When the changed entity has no version of its own, version the event by a
  smaller aggregate that does; never skip the event. Coordinator jobs that
  change directory state without a command (reapers, pruning) audit in the same
  statement, naming the affected home tenant as actor.
- The receiver inserts an inbox receipt and applies the effect in one
  transaction. A duplicate event id is a no-op; the same id with a different
  digest is a protocol error.
- A mutable projection carries a durable aggregate version, and the receiver
  keeps a per-aggregate watermark so an older event never overwrites newer
  state.
- A projection is rebuildable and never authoritative. Its absence must not
  turn an acknowledged operation into a false `404`; consult the operation
  ledger or authority while delivery is pending.

## Global claim workflows

Global uniqueness is a directory invariant, so signup, slug, and account-email
changes use reservation/finalization state machines, not outbox-only writes.

- Signup atomically reserves a provisioning DID, permanent handle, account
  email digest, and home tenant. The tenant then creates a non-loginable local
  account. A conditional global transition activates the route; only then may
  the local account become active and mint a session.
- Persist signup completion before contacting the directory: its encrypted
  provisioning payload, request digest, account email digest, DID, handle, and
  stable reserve and activate command ids live in the tenant operation row.
  Once that row exists, any transient directory or local-finalization failure
  returns `202` with the same operation id, including a connection failure
  known to precede transmission. A recovery worker and an exact client replay
  may both advance it. Check deterministic admission failures before preparing
  the operation.
- Every step is idempotent under one operation id; reconcilers finish
  interrupted operations. Reap expired provisioning reservations only after
  their lifetime exceeds the signup completion window. An orphaned local
  provisioning row can never authenticate and is removed after authoritative
  global absence.
- An account email change is a reserve/apply/finalize saga: reserve the new
  digest globally before anything local changes, update `hub_users` only after
  the reservation is confirmed, and finalize (freeing the old digest) only
  after that — never leave an address claimed by nobody or by two users.
  Tenant rules are in [`hub-signup.md`](hub-signup.md).
- Alias claim, change, and release are idempotent global commands. The home
  tenant enforces the required plan.
  - A downgrade removes local alias entitlement immediately and durably
    schedules release. Delivery delay may hold the slug but never makes it
    resolve to the downgraded user. The downgrade release carries the alias it
    saw, bypasses the seven-day user cooldown without changing its timestamp,
    and is a no-op if a newer alias replaced it. User-initiated claim, change,
    and release observe the cooldown.
  - Increment the global alias revision on every actual slug mutation,
    including forced release, so directory versions and outbox order stay
    monotonic.
  - Authenticated profile reads compare an alias route with the home tenant's
    effective alias; a stale directory alias returns not-found.
  - For a user-initiated change, enqueue the replayable operation and
    idempotent `202` response in one tenant transaction before any global
    call. Serialize enqueues per Hub user and record a durable dispatch attempt
    before sending the stable command id. Recovery replays a possibly sent
    command even if the profile version or entitlement changed. Apply a global
    success only against the accepted local profile version and previous
    alias; if that is no longer allowed, fail the operation and enqueue a
    conditional release of the new alias in one transaction — never leave a
    paid slug on a downgraded profile. Downgrade cleanup and this compensation
    are both release requests on the same retryable protocol.
- Principal migration freezes source writes, copies authoritative state and
  both sides of the reliability ledgers, verifies the copy, performs one
  versioned global routing flip, and keeps forwarding evidence for stale
  callers. Never reuse account-deletion cascades for migration cleanup.

## Reads and privacy

- A tenant resolves a profile slug locally first. For a remote result it uses
  the global directory and requests the permitted read-only representation
  from the home tenant over the mesh.
- Before returning an authenticated-only representation, the home tenant
  verifies the asserted viewer is homed by the calling tenant. The local Hub
  API sends the viewer DID and permanent handle from its session; the home
  tenant resolves the handle in the global directory to match the DID and the
  caller's mTLS tenant.
- Return only fields allowed for that audience. Complete work email addresses,
  exact verification instants, credentials, security state, and private
  account settings never cross the mesh.
- Do not persist remote profile shadows. Route caches hold routing metadata
  only.

## Verification

- Test command loss before and after send, lost responses, duplicate and
  changed-digest delivery, recovery-worker replay, stale routing, migration
  during retry, out-of-order events, directory outage, and receiver outage.
- Assert every committed mutation has exactly one audit event and one
  replayable outcome, and retries create no duplicate business rows or audit
  events.
- Exercise certificate rejection, tenant-identity mismatch, expired routes,
  unauthorized homing claims, and the absence of private fields on every mesh
  response.
