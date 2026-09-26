# Federation

Applies to global identity and routing, tenant-to-tenant reads and writes,
cross-tenant projections and notifications, principal migration, and every
workflow whose authoritative data lives outside the caller's tenant. Editing
mesh deployment, certificates, or Compose networking also needs
[`mesh-topology.md`](mesh-topology.md).

## Trust and topology

Deployment, certificate rotation, listener binding, and WireGuard/Compose
details are in [`mesh-topology.md`](mesh-topology.md).

- Private reachability is not authentication: every `mesh-api` has a distinct
  client certificate issued by the Vetchium private CA, and mesh and global
  services require HTTPS with mutual TLS. WireGuard gives reachability and mTLS
  gives workload authentication; neither substitutes for handler authorization.
- Derive the calling tenant from the verified client certificate, never from a
  request body, header, source IP, DNS name, or caller-supplied tenant id.
- Tenant mesh-api certificates carry exactly one canonical URI SAN
  `spiffe://mesh.vetchium.com/tenant/<tenant-id>/mesh-api`. Only a chain accepted
  by the configured private CA may populate the caller-tenant request context;
  the URI value is identity data, not an independently trusted assertion.
- A mesh HTTPS listener requires a private-CA client certificate during the TLS
  handshake. The coordinator healthcheck's client certificate identifies a system
  health workload, not a tenant: it may reach `/healthz` but must never populate
  a tenant identity or authorize a directory operation.
- A tenant mesh API has two listeners. The tenant-local HTTP relay on `8080`
  accepts only health checks or the mounted bearer credential from that tenant's
  API servers and workers. The peer HTTPS listener on `8443` requires a
  private-CA client certificate and applies certificate-derived mesh identity
  middleware to every route. Never register a peer-facing endpoint on the relay
  mux or expose a relay credential to a peer.
- Browser-facing APIs and portals never receive mesh credentials; the browser
  talks only to its authenticated home tenant.
- The global service and its database are mesh-internal, never internet facing.
  `https://vetchium.com/u/<handle>` is a public navigation entry point, not
  access to the global database or profile data.
- The trust model handles crash-stop failures, timeouts, partitions, retries,
  duplicates, and reordering. It does not attempt Byzantine fault tolerance
  between Vetchium-operated tenants.

## Global directory

- One global PostgreSQL database owns principal routing and globally unique
  profile slugs. For a Hub user it stores only the stable DID, permanent
  generated handle, optional paid alias, home tenant, routing version, lifecycle
  state, and timestamps needed to enforce those invariants.
- Never put credentials, raw email addresses, profile fields, work-email
  evidence, subscription state, hiring data, or other tenant-owned business data
  in it.
- Generated handles are globally unique, permanent, never reused. A paid alias
  is a separate globally unique claim that may be released and immediately
  reassigned. Handle and alias syntax are disjoint so one `/u/<slug>` lookup is
  unambiguous.
- A global route is versioned. A cache may choose a destination but never
  authorizes a caller. Re-resolve on expiry, relocation responses, and before a
  security-sensitive homing decision.
- Local authoritative reads continue during a global outage. A remote read may
  use an unexpired cached route, otherwise it fails within a configured timeout.
  Signup, alias changes, and other global uniqueness decisions fail closed when
  the directory is unavailable.

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
command-result ledger at the authoritative tenant; no bespoke reliability
protocol per feature.

1. Require an idempotency key for every resource-creating request and every
   cross-tenant side effect.
2. Before the first network call, the initiating tenant commits the idempotency
   row and a pending operation holding: a pre-minted operation/command id, any
   pre-minted resource id, the authoritative principal DID, the initiating
   principal type and id (for status authorization), a canonical request digest,
   and the replayable logical command payload. Never store a bearer secret in
   the payload. The initiating principal need not own the aggregate: an
   applicant-owned operation may target an opening in another tenant.
3. Resolve the authoritative tenant, then send the command with the same command
   id and correlation id on every attempt.
4. The authority rejects a reused command id with a different digest, and
   replays the stored result for the same digest.
5. On first execution, the authority commits the business mutation, audit event,
   replayable command result, and any outgoing events in one local transaction.
6. A definite success or deterministic `4xx` resolves the initiating operation.
   If the command was sent but its outcome is unknown, return `202 Accepted`
   with the durable operation id. If no command was issued because routing or
   connection setup failed, return a retryable `503` or `504`.
7. A recovery worker re-resolves the owner and re-drives the identical command
   until it obtains the stored outcome. The client may poll the operation or
   retry the original request with the same idempotency key.

For Hub browser workflows, return the shared
`Vetchium.Hub.Operations.PendingOperation` body with HTTP `202` when the outcome
is uncertain. The initiating Hub user polls `/api/hub/operations/status` for
`pending`, `succeeded`, or `failed`, and replays the original request with its
original idempotency key to get the workflow-specific typed result. The status
endpoint must authorize operation ownership (an operation id alone is not a read
capability) and stay free of replayable command payloads and secrets. Reuse this
shape for future remote-job-application commands rather than a per-feature
polling protocol.

Never use PostgreSQL prepared transactions, an HTTP prepare/commit protocol, or
a cross-database transaction: two databases in one atomic commit couple
availability and leave prepared work needing operator recovery.

## Transactional outbox and inbox

- An outbox is for effects after an authoritative commit: projections,
  notifications, object deletion, cache invalidation, other retryable delivery.
  Enqueuing an event does not prove a remote business command succeeded and does
  not replace the command ledger.
- Insert the outbox event in the same local transaction as the state change that
  caused it. Deliver at least once with bounded exponential backoff and
  operational alerting for sustained failure.
- The receiver inserts an inbox receipt and applies the effect in one local
  transaction. Duplicate event ids are no-ops; the same id with a different
  digest is a protocol error.
- A mutable projection carries a durable aggregate version, and the receiver
  keeps a per-aggregate watermark so delayed older events cannot overwrite newer
  state.
- A projection is rebuildable and never authoritative. Its absence must not turn
  an acknowledged operation into a false `404`; consult the operation ledger or
  authoritative tenant while delivery is pending.

## Global claim workflows

Global uniqueness is a directory invariant, so signup and slug changes use a
reservation/finalization state machine, not an outbox-only write.

- Signup atomically reserves a provisioning DID, permanent handle, and home
  tenant in the global database. The tenant then creates a non-loginable local
  account. A conditional global transition activates the route; only after that
  succeeds may the local account become active and mint a session.
- Persist signup completion before contacting the directory: keep its encrypted
  provisioning payload, request digest, DID, handle, and stable reserve and
  activate command IDs in the tenant operation row. Once that row exists, any
  transient directory or local-finalization failure returns `202 Accepted` with
  the same operation ID, including a connection failure known to precede
  transmission. A recovery worker and an exact client replay may both advance the
  same state machine. Check deterministic admission failures before preparing the
  operation.
- Tenant Hub APIs and workers call their local mesh API with the mounted relay
  credential. Only the mesh API calls the global coordinator, using the tenant's
  mTLS identity. Never give portal APIs coordinator credentials or expose
  directory endpoints on portal ingress.
- Every step is idempotent under one operation id; reconcilers finish
  interrupted operations. Expired provisioning reservations are reaped only after
  their lifetime exceeds the signup completion window. An orphaned local
  provisioning row can never authenticate and is removed after authoritative
  global absence.
- Alias claim, change, and release are idempotent global commands. The home
  tenant enforces the required plan.
  - A downgrade removes local alias entitlement immediately and durably
    schedules release. Delivery delay may temporarily hold the slug but must
    never make it resolve to the downgraded user. The downgrade release carries
    the alias it saw, bypasses the user-initiated seven-day cooldown without
    changing its timestamp, and is a no-op if a newer alias replaced it. A
    user-initiated claim, change, or release still observes the cooldown.
  - Increment the global alias revision on every actual slug mutation, including
    forced release, so directory versioning and outbox order stay monotonic even
    when the cooldown timestamp is unchanged.
  - Authenticated profile reads compare an alias route with the home tenant's
    effective alias; a stale directory alias returns not-found.
  - For a user-initiated change, enqueue the replayable operation and idempotent
    `202` response in one tenant transaction before any global call. Serialize
    enqueues per Hub user and record a durable dispatch attempt before
    transmitting the stable global command ID. A recovery worker must replay a
    possibly sent command even if the user's profile version or paid entitlement
    changed since. Apply a successful global result only against the accepted
    local profile version and previous alias. If local application is no longer
    allowed, atomically fail the operation and enqueue a conditional release of
    the newly claimed alias; never leave a paid slug attached to a downgraded
    profile. Downgrade cleanup and this compensation are both release requests
    using the same retryable operation protocol.
- Principal migration freezes source writes, copies authoritative state plus both
  sides of the reliability ledgers, verifies the copy, performs one versioned
  global routing flip, and retains forwarding evidence for stale callers. Never
  reuse account-deletion cascades for migration cleanup.

## Reads and privacy

- A tenant resolves a profile slug locally first. For a remote result it uses the
  global directory and requests the permitted read-only representation from the
  home tenant over the authenticated mesh.
- Before returning an authenticated-only profile representation, the home tenant
  verifies the asserted viewer is homed by the calling tenant. The local Hub API
  derives viewer DID and permanent handle from its session and sends both; the
  home tenant resolves the handle in the global directory to match the DID and
  the caller's mTLS tenant identity.
- Return only fields allowed for that audience. Complete work email addresses,
  exact verification instants, credentials, security state, and private account
  settings never cross the mesh.
- Do not persist remote profile shadows. Route caches hold routing metadata, not
  authoritative profile content.

## Verification

- Test command loss before send, loss after send, lost responses, duplicate and
  changed-digest delivery, recovery-worker replay, stale routing, migration
  during retry, out-of-order events, global-directory outage, and receiver
  outage.
- Assert every committed mutation has exactly one audit event and one replayable
  command outcome, while retries create no duplicate business rows or audit
  events.
- Exercise certificate rejection, tenant-identity mismatch, expired routes,
  unauthorized homing claims, and the absence of private fields on every mesh
  response.
