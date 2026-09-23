# Federation

Applies to global identity and routing, tenant-to-tenant reads and writes,
cross-tenant projections and notifications, principal migration, and every
workflow whose authoritative data lives outside the caller's tenant. Compose it
with the backend, database, TypeSpec, UI, Playwright, signup, and subscription
guides for the layers involved.

## Trust and topology

- Tenant services communicate through the private WireGuard mesh. Private
  reachability is not authentication: every `mesh-api` has a distinct client
  certificate issued by the Vetchium private CA, and mesh and global services
  require HTTPS with mutual TLS.
- Derive the authenticated calling tenant from the verified client certificate,
  never from a request body, header, source IP, DNS name, or caller-supplied
  tenant id. Keep private keys in mounted secrets and support overlapping
  certificate rotation.
- Tenant mesh-api certificates carry exactly one canonical URI SAN of the form
  `spiffe://mesh.vetchium.com/tenant/<tenant-id>/mesh-api`. Only a certificate
  chain accepted by the configured private CA may populate the caller-tenant
  request context; the URI value is identity data, not an independently trusted
  assertion.
- A mesh HTTPS listener requires a private-CA client certificate during the TLS
  handshake. The global coordinator's container healthcheck uses a distinct
  client-auth certificate whose URI identifies a system health workload, not a
  tenant; that certificate may reach `/healthz` but must never populate a
  tenant identity or authorize a directory operation.
- Production coordinator DNS resolves only to its WireGuard address. Deployment
  must verify the tenant route uses the configured WireGuard interface, and the
  coordinator host firewall must drop its published port on every public
  interface. WireGuard provides reachability, while mTLS provides workload
  authentication; neither substitutes for handler authorization.
- Permit CA overlap for rotation by accepting a CA bundle. Version Docker
  secret names so operators can deploy an old-plus-new trust bundle, roll each
  leaf certificate, and then remove the old CA without distributing mesh keys
  to browser-facing processes.
- Browser-facing APIs and portals never receive mesh credentials. The browser
  talks only to its authenticated home tenant.
- A tenant mesh API has two distinct listeners. The tenant-local HTTP relay on
  port `8080` accepts only health checks or the mounted bearer credential from
  that tenant's API servers and workers. The peer HTTPS listener on port `8443`
  requires a private-CA client certificate and applies certificate-derived
  mesh identity middleware to every route. Never register a peer-facing
  endpoint on the local relay mux or expose a relay credential to a peer.
- Every tenant mesh API has separate client and server key pairs. Its server
  certificate covers `<tenant-id>.mesh.vetchium.com`; private DNS resolves that
  name to the tenant host's WireGuard address. Production publishes only the
  peer listener in host mode, and the host firewall restricts that port to the
  WireGuard interface.
- Development and CI Compose run real WireGuard rather than standing in for it
  with a plain Docker network. Each tenant and the coordinator get a `wg-*`
  node built from `dev/wireguard/`, holding a `wg0` interface at a
  `10.242.0.0/24` address, and the matching `mesh-api` or `global-coordinator`
  joins that node's network namespace. The `mesh` Docker network is only the
  underlay those nodes use to find each other, standing in for the network
  between production VMs. Each node's hosts file maps every
  `*.mesh.vetchium.com` name to a WireGuard address, so peer clients verify the
  same server name and take the same encrypted path in every environment.
  Because a namespace-sharing service inherits its donor's hosts file, those
  mappings belong on the `wg-*` node, and `extra_hosts` on the service itself
  is refused outright.
- A tenant's peer listener binds only its WireGuard address, so cross-tenant
  traffic cannot fall back to the underlay. The tenant-local relay stays on all
  interfaces: its callers are that tenant's own API servers and workers, which
  share the host in production and the backend network here. `make dev-secrets`
  generates the development WireGuard keypairs; production keys live in each
  host's own encrypted configuration and are never generated here.
- Development and CI Compose assign each isolated network a distinct `/24`
  within `10.231.0.0/16`. The four-tenant topology exceeds Docker's default
  address-pool capacity on some hosts; do not merge tenant networks to work
  around this. If the range overlaps a host VPN or LAN, set
  `VETCHIUM_DOCKER_NETWORK_OCTET` to a free second octet for the whole Compose
  project before startup. Keep development and CI network mappings identical.
- The global service and its database are mesh-internal and never internet
  facing. `https://vetchium.com/u/<handle>` is a public navigation entry point,
  not access to the global database or profile data.
- The current trust model handles crash-stop failures, timeouts, partitions,
  retries, duplicates, and reordering. It does not attempt Byzantine fault
  tolerance between Vetchium-operated tenants.

## Global directory

- One global PostgreSQL database owns principal routing and globally unique
  profile slugs. For a Hub user it stores only the stable DID, permanent
  generated handle, optional paid alias, home tenant, routing version, lifecycle
  state, and timestamps needed to enforce those invariants.
- Do not put credentials, raw email addresses, profile fields, work-email
  evidence, subscription state, hiring data, or other tenant-owned business
  data in the global database.
- Generated Hub handles are globally unique, permanent, and never reused. A
  paid alias is a separate globally unique claim that may be released and
  immediately reassigned. Handle and alias syntax are disjoint so one
  `/u/<slug>` lookup is unambiguous.
- A global route is versioned. A cache may choose a destination, but it never
  authorizes a caller. Re-resolve on expiry, relocation responses, and before a
  security-sensitive homing decision.
- Local authoritative reads must continue during a global outage. A remote read
  may use an unexpired cached route; otherwise it fails within a configured
  timeout. Signup, alias changes, and other global uniqueness decisions fail
  closed when the directory is unavailable.

## Authority

- Every aggregate has exactly one authoritative tenant. Profiles and user-owned
  settings belong to the Hub user's home tenant. Applications, candidacies,
  interviews, and offers belong to the opening owner's tenant.
- A remote principal is represented by its DID and a non-authoritative routing
  hint, never by a required shadow account row.
- The authoritative tenant validates business rules, authorization, state, and
  concurrency. Routing evidence and an authenticated calling tenant never
  substitute for business authorization.
- Reads may be proxied synchronously. Writes are commands to the aggregate's
  authority and follow the durable protocol below.

## Durable cross-tenant commands

Use one generic operation ledger at the initiating tenant and one generic
command-result ledger at the authoritative tenant. Do not create a bespoke
reliability protocol per feature.

1. Require an idempotency key for every resource-creating request and every
   cross-tenant side effect.
2. Before the first network call, the initiating tenant commits the idempotency
   row and a pending operation containing a pre-minted operation/command id,
   any pre-minted resource id, the authoritative principal DID, the initiating
   principal type and id for status authorization, a canonical request digest,
   and the replayable logical command payload. Never store a bearer secret in
   that payload. The initiating principal is not necessarily the aggregate
   owner: an applicant-owned operation may target an opening in another tenant.
3. Resolve the authoritative tenant, then send the command with the same command
   id and correlation id on every attempt.
4. The authoritative tenant rejects a reused command id with a different
   digest. With the same digest it replays the stored result.
5. On the first execution, the authority commits the business mutation, audit
   event, replayable command result, and any outgoing events in one local
   transaction.
6. A definite success or deterministic `4xx` resolves the initiating operation.
   If the command was sent but its outcome is unknown, return `202 Accepted`
   with the durable operation id. If no command was issued because routing or
   connection setup failed, return a retryable `503` or `504` instead.
7. A recovery worker re-resolves the owner and re-drives the identical command
   until it obtains the stored outcome. The client may poll the operation or
   retry the original request with the same idempotency key.

For Hub browser workflows, return the shared
`Vetchium.Hub.Operations.PendingOperation` body with HTTP `202` when the
outcome is uncertain. The initiating Hub user can poll
`/api/hub/operations/status` for `pending`, `succeeded`, or `failed` and replay
the original request with its original idempotency key to obtain the
workflow-specific typed result. The status endpoint must authorize operation
ownership; an operation id alone is not a read capability. Reuse this shape for
future remote-job-application commands rather than adding a per-feature polling
protocol. Keep status free of replayable command payloads or secrets.

Do not use PostgreSQL prepared transactions, an HTTP prepare/commit protocol,
or a cross-database transaction. Holding two databases in one atomic commit
couples availability and leaves prepared work requiring operator recovery.

## Transactional outbox and inbox

- An outbox is for effects after an authoritative commit: projections,
  notifications, object deletion, cache invalidation, and other retryable
  delivery. Enqueuing an event does not prove that a remote business command
  succeeded and does not replace the command ledger.
- Insert an outbox event in the same local transaction as the state change that
  caused it. Deliver at least once with bounded exponential backoff and
  operational alerting for sustained failure.
- The receiver inserts an inbox receipt and applies the effect in one local
  transaction. Duplicate event ids are no-ops; the same id with a different
  digest is a protocol error.
- A mutable projection carries a durable aggregate version. The receiver keeps
  a per-aggregate watermark so delayed older events cannot overwrite newer
  state.
- A projection is rebuildable and never authoritative. Its absence must not
  turn an acknowledged operation into a false `404`; consult the operation
  ledger or authoritative tenant while projection delivery is pending.

## Global claim workflows

Global uniqueness is a directory invariant, so signup and slug changes use a
reservation/finalization state machine rather than an outbox-only write.

- Signup atomically reserves a provisioning DID, permanent handle, and home
  tenant in the global database. The tenant then creates a non-loginable local
  account. A conditional global transition activates the route; only after that
  succeeds may the local account become active and mint a session.
- Persist signup completion before contacting the directory. Keep its encrypted
  provisioning payload, request digest, DID, handle, and stable reserve and
  activate command IDs in the tenant operation row. Once that row exists, any
  transient directory or local-finalization failure returns `202 Accepted` with
  the same operation ID; this includes a connection failure that is known to
  precede transmission. A recovery worker and an exact client replay may both
  advance the same state machine. Check deterministic admission failures before
  preparing the operation.
- Tenant Hub APIs and workers call their local mesh API with the mounted relay
  credential. Only the mesh API calls the global coordinator, using the
  tenant's mutual-TLS identity. Do not give portal APIs direct coordinator
  credentials or expose directory endpoints on portal ingress.
- Every step is idempotent under one operation id. Reconcilers finish interrupted
  operations. Expired provisioning reservations are reaped only after their
  lifetime exceeds the signup completion window; an orphaned local provisioning
  row can never authenticate and is removed after authoritative global absence.
- Alias claim, change, and release are idempotent global commands. The home
  tenant enforces the required plan. A downgrade removes local alias entitlement
  immediately and durably schedules release; delivery delay may temporarily
  hold the slug, but must never make it resolve to the downgraded user. The
  downgrade release carries the alias it saw, bypasses the user-initiated
  seven-day cooldown without changing its timestamp, and is a no-op if a newer
  alias has replaced it. A user-initiated claim, change, or release still
  observes the cooldown. Increment the global alias revision on every actual
  slug mutation, including forced release, so directory versioning and outbox
  order remain monotonic even when the cooldown timestamp stays unchanged.
  Authenticated profile reads compare an alias route with the home tenant's
  effective alias; a stale directory alias must return not-found.
  For user-initiated alias changes, enqueue the replayable operation and
  idempotent `202` response in one tenant transaction before any global call.
  Serialize enqueues per Hub user and record a durable dispatch attempt before
  transmitting the stable global command ID. A recovery worker must replay a
  possibly sent command even if the user's profile version or paid entitlement
  subsequently changed. Apply a successful global result only against the
  accepted local profile version and previous alias. If local application is
  no longer allowed, atomically fail that operation and enqueue a conditional
  release of the newly claimed alias; never leave a paid slug attached to a
  downgraded profile. A release request may be a downgrade cleanup or this
  compensation, and both use the same retryable operation protocol.
- Principal migration freezes source writes, copies authoritative state plus
  both sides of the reliability ledgers, verifies the copy, performs one
  versioned global routing flip, and retains forwarding evidence for stale
  callers. Never reuse account-deletion cascades for migration cleanup.

## Reads and privacy

- A tenant resolves a profile slug locally first. For a remote result it uses
  the global directory and requests the permitted read-only representation from
  the home tenant over the authenticated mesh.
- The home tenant verifies that the asserted viewer is homed by the calling
  tenant before returning an authenticated-only profile representation. The
  local Hub API derives both viewer DID and permanent handle from its session;
  the peer request carries both, and the home tenant resolves the handle in the
  global directory to match the DID and the caller's mTLS tenant identity.
- Return only fields allowed for that audience. Complete work email addresses,
  exact verification instants, credentials, security state, and private account
  settings never cross the mesh.
- Do not persist remote profile shadows. Route caches contain routing metadata,
  not authoritative profile content.

## Verification

- Test command loss before send, loss after send, lost responses, duplicate and
  changed-digest delivery, recovery-worker replay, stale routing, migration
  during retry, out-of-order events, global-directory outage, and receiver
  outage.
- Assert that every committed mutation has exactly one audit event and one
  replayable command outcome, while retries create neither duplicate business
  rows nor duplicate audit events.
- Exercise certificate rejection, tenant-identity mismatch, expired routes,
  unauthorized homing claims, and the absence of private fields on every mesh
  response.
