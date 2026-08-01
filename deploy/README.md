# Production deployment

The production files deploy one tenant per single-node Docker Swarm. Each
tenant stack contains PostgreSQL, Traefik, three portals, and six backend
services: `admin-api`, `hub-api`, `orgs-api`, `mesh-api`, `mcp-server`, and
`workers`.

Images are pulled from the configured registry. Nothing is built from this
directory.

## Deploy

On the Linux server:

```bash
cp .env.example .env
vi .env
vi sgp/traefik.yml             # replace example hostnames if needed

make deploy REGION=sgp TAG=v1.2.3
```

The Makefile initializes Swarm when necessary and creates the tenant database
secrets on first use. Tags must be immutable; `latest` and `dev` are rejected.
`POSTGRES_USER` and `POSTGRES_DB` are required. `REGISTRY` defaults to
`ghcr.io/vetchium`, `HTTP_PORT` defaults to `80`, and `PGSSLMODE` defaults to
`disable` until PostgreSQL TLS is configured.

For an existing stack, migrations and database post-install setup run before
`docker stack deploy`. A failure leaves the running stack untouched. On the
first deployment, the database must be started first, so the stack starts,
PostgreSQL becomes ready, migrations are applied, and post-install access setup
is reconciled.

## Runtime boundaries

- Traefik is the only publicly exposed ingress. For each portal hostname it
  sends `/api` to the matching `admin-api`, `hub-api`, or `orgs-api` over a
  dedicated private access network; all other paths go to the static portal.
- `mesh-api`: private `mesh` plus `backend`; no published port and no ingress.
- `mcp-server`: private `mcp_access` plus `backend`; Traefik can reach the
  network, but no MCP router is configured by default.
- `workers`: `backend` only and exactly one replica per tenant. The current
  heartbeat loop has no distributed coordination, so do not scale this service
  beyond one replica until task-level locking is implemented.

## MCP publication

Do not make MCP public merely by attaching it to `ingress`. Once OAuth/TLS and
request policy are implemented, add a dedicated hostname router to the tenant's
`traefik.yml` whose service URL is `http://mcp-server:8080`. The existing
`mcp_access` network already provides the private path from Traefik.

## Future WireGuard mesh

The `mesh` overlay is internal and attachable. A future WireGuard gateway can
join it while `mesh-api` remains unpublished. The gateway must be the only
cross-host ingress to that network, bind forwarding to the WireGuard interface,
and restrict peers and destination ports with host firewall rules. Continue to
authenticate calls at `mesh-api`; WireGuard protects transport and peer network
membership but is not sufficient request authorization by itself.

## Secrets and migrations

PostgreSQL administrator and application credentials are separate Swarm
secrets. Migrations connect as `POSTGRES_USER`; runtime services use
`PGPASSWORD_FILE` with the DML-only `vetchium_app` role, so neither password
appears in service environment variables. After migrations, `make deploy` runs
`database/post-install.sql` as the database owner to reconcile the login and
runtime privileges. Role and access policy are not part of migration history.

The migration container is a one-shot plain container because Swarm has no Job
primitive. The Makefile reads the secret from the database task into a
permission-restricted temporary env file, joins the tenant backend network,
runs the published migration image, and removes the file.

## Operations

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

Application services roll start-first. The workers and PostgreSQL roll
stop-first. PostgreSQL remains a single instance on node-local storage, so add
tested off-host backups before production use.
