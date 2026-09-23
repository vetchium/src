# Production deployment

The production files deploy one tenant per single-node Docker Swarm. Each
tenant stack contains PostgreSQL, an isolated SeaweedFS master, volume server,
filer, and authenticated S3 gateway, Traefik, three portals, and six backend
services: `admin-api`, `hub-api`, `orgs-api`, `mesh-api`, `mcp-server`, and
`workers`.

`global-coordinator/stack.json` is a separate singleton deployment with its own
PostgreSQL database and durable volume. The database contains only global
principal routing, permanent handles, paid aliases, and the protocol ledgers
needed to change them safely; tenant-owned profiles, credentials, and hiring
data remain in tenant databases. The service also exposes authenticated region
discovery. `signup-regions.json` is the region catalog shared by every stack,
mounted read-only into `hub-api`, `mesh-api`, and the coordinator.

Images are pulled from the configured registry. Nothing is built from this
directory.

## Deploy

On the Linux server:

```bash
cp .env.example .env
vi .env
vi sgp/traefik.json            # replace example hostnames if needed

make deploy REGION=sgp TAG=v1.2.3
```

Deploy the coordinator once on its designated WireGuard host:

```bash
make deploy-global-coordinator TAG=v1.2.3 \
  GLOBAL_POSTGRES_USER=global_admin GLOBAL_POSTGRES_DB=global_db
```

The Makefile initializes Swarm when necessary and creates the tenant and global
database secrets on first use. It also creates three tenant-specific SeaweedFS
S3 secrets together: the gateway identity configuration and its access and
secret keys. A partial set stops deployment. Do not replace just one of these
secrets; rotate all three as a coordinated change and roll the gateway and its
clients together. Only `hub-api`, `mesh-api`, and `workers` receive the S3 client
keys; only the gateway receives the identity configuration. Tags must be
immutable; `latest` and `dev` are
rejected. `POSTGRES_USER` and `POSTGRES_DB` are required for a tenant;
`GLOBAL_POSTGRES_USER` and `GLOBAL_POSTGRES_DB` are required for the global
stack. `REGISTRY` defaults to
`ghcr.io/vetchium`, `HTTP_PORT` defaults to `80`, and `PGSSLMODE` defaults to
`disable` until PostgreSQL TLS is configured. `ADMIN_UI_DEFAULT_LANGUAGE` and
`HUB_UI_DEFAULT_LANGUAGE` select their portal's fallback locale after saved and
browser preferences. Each variable is validated against its portal's own
supported locale set; both currently accept `en-US`, `ta`, and `de-DE`. Each
region's `config.json`
contains the shared non-secret configuration for every backend program and is
mounted read-only at `/etc/vetchium/config.json`. `POSTGRES_DB` and `PGSSLMODE`
remain deployment-time overrides so existing installations can select their
database and TLS policy without rewriting the file. The content hash in the
Swarm config name causes the backend services to roll when the file changes.

Each tenant's `globalCoordinator.baseURL` resolves
`global-coordinator.internal` to the coordinator's WireGuard address. Both
deployment targets refuse to proceed unless the configured WireGuard interface
exists; a tenant also verifies that its coordinator route uses that interface.
The coordinator port is published in host mode, so the coordinator host's
firewall must accept that port only on the WireGuard interface and must drop it
on public interfaces. This firewall rule is an operator prerequisite because
Docker Swarm cannot bind a host-mode published port to one host address.

Only `mesh-api` joins `global_coordinator_egress` and receives its tenant's
private-CA client certificate and key. The coordinator requires and verifies a
client certificate during every TLS handshake, then derives the caller tenant
from its canonical URI SAN. Each tenant mesh API also has a separate server
certificate and listens for peer traffic on port `8443`; the host-mode
`MESH_API_PORT` publication must be accepted only on the WireGuard interface.
Private DNS maps `<region>.mesh.vetchium.com` to that tenant host's
`MESH_API_WIREGUARD_IP`, matching the server certificate. The healthcheck uses
a separate non-tenant client certificate. Portal APIs receive only the separate per-region
`<region>_mesh_credential` used to reach their own mesh API; they receive no
cross-tenant key material.

The required external secrets are the CA bundle, coordinator server key pair,
coordinator healthcheck key pair, and distinct client and server key pairs for
every tenant mesh API.
The CA secret may contain both old and new CA certificates during rotation.
Rotate by deploying the overlap bundle first, rolling leaf certificates one
tenant at a time, then deploying the new-only CA bundle. Docker secrets are
immutable, so each rotation uses new versioned Docker-secret names and updates
the stack's external-secret mappings before the roll.

`hubAPIServer.signup.enabled` must agree with the region's `signupEnabled` in
`signup-regions.json`. `hub-api` compares them at startup and refuses to run if
they disagree, because discovery would otherwise send visitors to a region that
then refuses them. Changing either one means rolling the catalog and the
region's config together.

`hubAPIServer.offeredPlans` in each tenant's `config.json` must agree with
`VETCHIUM_HUB_PLANS` for that tenant's `hub-ui` service in `stack.json`, and
`tenantId` must agree with `VETCHIUM_TENANT_ID`. Nothing compares them at
container startup, because `hub-ui` is a static nginx container; a
repository test, `TestCheckedInHubPlansMatchPortalConfiguration` in
`backend/internal/appconfig`, compares every checked-in environment instead.
When the two disagree, either the portal offers a plan the backend refuses
(shown to the visitor as a translated error when they choose it), or the
portal hides a plan the backend would otherwise accept. Simulated payments
are enabled in every environment, production included, so anyone who can
sign up in production can take a paid plan without paying; there is no
setting to disable simulation until a payment processor is integrated.
Adding a plan means migrating the database first, then deploying `hub-api`
and `workers` from the same release, and release `hub-ui` before listing the
plan in `VETCHIUM_HUB_PLANS`: a database with a plan a running binary does not
recognize causes that plan's rows to be skipped by the worker and rejected by
`StateFromStored` until the new binaries are live, and `runtime-config.sh`
hard-codes the plan list, so listing a new plan before releasing the image
stops `hub-ui` from starting.

For an existing tenant or global stack, its migrations run before
`docker stack deploy`. A failed migration leaves the running stack untouched.
On a first deployment, the database is started first. Its image initializes the
empty data volume, including the runtime role and access policy, before
PostgreSQL becomes ready; the matching tenant or global migrations are then
applied.

## Runtime boundaries

- Traefik is the only publicly exposed ingress. For each portal hostname it
  sends `/api` to the matching `admin-api`, `hub-api`, or `orgs-api` over a
  dedicated private access network; all other paths go to the static portal.
- `mesh-api`: private `mesh` and `backend`, plus `global_coordinator_egress`.
  Its local port `8080` is not published and accepts the tenant-local bearer
  relay. Its peer port `8443` is published in host mode only for WireGuard
  peers and requires a private-CA client certificate. It is the only service
  that dials the coordinator, so it is the only one on that egress network.
- `mcp-server`: private `mcp_access` plus `backend`; Traefik can reach the
  network, but no MCP router is configured by default.
- `workers`: `backend` only and exactly one replica per tenant. Do not scale this
  service beyond one replica until task-level locking is implemented.
- The four SeaweedFS services join only `backend`. Their S3 gateway has no
  published host port. Its startup guard rejects a missing or empty identity
  secret, and its healthcheck requires unauthenticated requests to be denied.
  The master, filer, volume, IAM, and write/list paths must remain private.

The shared JSON configuration has the same file-mount shape as a future
Kubernetes ConfigMap. The PostgreSQL password remains a separate secret mount;
only its file path appears in the JSON.

## MCP publication

Do not make MCP public merely by attaching it to `ingress`. Once OAuth/TLS and
request policy are implemented, add a dedicated hostname router to the tenant's
`traefik.json` whose service URL is `http://mcp-server:8080`. The existing
`mcp_access` network already provides the private path from Traefik.

## WireGuard mesh

Every production host must join the private WireGuard mesh before deployment.
`GLOBAL_COORDINATOR_WIREGUARD_IP`, `MESH_API_WIREGUARD_IP`,
`WIREGUARD_INTERFACE`, private DNS, peer allowed-addresses, and host firewall
policy are infrastructure inputs, not application discovery. The `mesh`
overlay stays internal. The tenant peer listener is the only mesh API port
published from the host and the firewall must accept it only from the WireGuard
interface. WireGuard supplies private reachability, while mutual TLS supplies
workload identity and request authentication.

## Secrets and migrations

PostgreSQL administrator and application credentials are separate Swarm
secrets for every tenant and for the global database. Migrations connect as the
configured administrator; runtime services read the application-password file
for the DML-only `vetchium_app` role, so neither password appears in JSON or
service environment variables.

The pinned official PostgreSQL image receives initialization files as Swarm
configs. Its `/docker-entrypoint-initdb.d` hook reads the application secret and
creates the runtime role, the `vetchium` schema, and default privileges exactly
once, while the tenant data volume is empty. PostgreSQL skips that hook on every
later start. Initialization changes therefore require an explicit operational
plan for an existing database; they are not reapplied during deployment.
Application-password rotation must likewise update the PostgreSQL role and the
Swarm secret as one coordinated operation; changing only the secret is not a
rotation procedure.

The migration container is a one-shot plain container because Swarm has no Job
primitive. The Makefile reads the secret from the database task into a
permission-restricted temporary env file, joins the tenant backend network,
runs the published migration image, and removes the file.

## Operations

Backend processes write structured JSON logs to standard output with source,
component, tenant, event, and error fields where applicable. Internal request
failures use `event=request_error`, worker failures use
`event=worker_job_error`, and fatal startup/runtime failures use
`event=process_exit`. Expected client and authentication failures are logged at
warning level so SIEM rules can retain them without treating ordinary 4xx
traffic as PagerDuty-worthy application failures.

```bash
docker stack services sgp
docker service logs -f sgp_admin-api
docker service logs -f sgp_hub-api
docker service logs -f sgp_orgs-api
docker service logs -f sgp_mesh-api
docker service logs -f sgp_mcp-server
docker service logs -f sgp_workers
docker service ps sgp_admin-api
```

Application services roll start-first. The workers, PostgreSQL, and SeaweedFS
roll stop-first. PostgreSQL and SeaweedFS remain single instances on node-local
storage, so add tested off-host backups before production use.

## SeaweedFS backup and restore

The SeaweedFS master, volume server, and filer use separate persistent volumes
per tenant. Back up all three as a unit with that tenant's PostgreSQL volume;
the database owns object references and deletion work, while SeaweedFS owns
the bytes. Quiesce profile writes and background object deletion before taking
a consistent snapshot. Preserve the tenant's S3 identity configuration and
both keys in the secrets backup. Store backups off-host and encrypted. Never
recreate an empty object volume while retaining the old database reference
rows.

For a restore, stop application writes and workers, restore the database and
all three SeaweedFS volumes from the same recovery point, restore or remap the
three S3 secrets, and then start the storage gateway and application services.
Verify that representative referenced objects can be read with signed S3
requests, anonymous requests are denied, and no SeaweedFS host port is
published. Only then resume writes and deletion work. A database-only or
object-only restore requires an explicit reconciliation of missing and orphaned
objects before reopening the tenant.
