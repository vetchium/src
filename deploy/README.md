# Production deployment

The production files deploy one tenant per single-node Docker Swarm. Each
tenant stack contains PostgreSQL, Traefik, three portals, and six backend
services: `admin-api`, `hub-api`, `orgs-api`, `mesh-api`, `mcp-server`, and
`workers`.

`global-coordinator/stack.json` is a separate singleton deployment. It has no
database and currently exposes only authenticated short-ID generation. Its
small state volume stores the last allocated counter so normal restarts cannot
reuse an identifier.

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

Deploy the coordinator once on its designated host with the same bearer
credential that is distributed as a Docker secret to tenant callers:

```bash
make deploy-global-coordinator TAG=v1.2.3
```

The Makefile initializes Swarm when necessary and creates the tenant database
secrets on first use. Tags must be immutable; `latest` and `dev` are rejected.
`POSTGRES_USER` and `POSTGRES_DB` are required. `REGISTRY` defaults to
`ghcr.io/vetchium`, `HTTP_PORT` defaults to `80`, and `PGSSLMODE` defaults to
`disable` until PostgreSQL TLS is configured. `ADMIN_UI_DEFAULT_LANGUAGE`
selects the Admin portal locale used by browsers that have no saved locale;
the supported values are `en-US`, `ta`, and `de_DE`. Each region's `config.json`
contains the shared non-secret configuration for every backend program and is
mounted read-only at `/etc/vetchium/config.json`. `POSTGRES_DB` and `PGSSLMODE`
remain deployment-time overrides so existing installations can select their
database and TLS policy without rewriting the file. The content hash in the
Swarm config name causes the backend services to roll when the file changes.

Each tenant's `global-coordinator.baseURL` must resolve to the coordinator over
the operator's private HTTP network. Do not expose the coordinator directly to
the public Internet. The singleton must retain its named state volume and use
stop-first updates; do not scale it horizontally. Restrict each tenant's
`global_coordinator_egress` network at the host firewall to the configured
coordinator destination. Losing the state volume removes the no-reuse
guarantee, so back it up and restore it with the service. Docker secrets are
immutable; credential rotation requires coordinated replacement of the global
and per-tenant secrets before their services are redeployed.

For an existing stack, migrations run before `docker stack deploy`. A failed
migration leaves the running stack untouched. On the first deployment, the
database must be started first. Its image initializes the empty data volume,
including the runtime role and access policy, before PostgreSQL becomes ready;
migrations are then applied.

## Runtime boundaries

- Traefik is the only publicly exposed ingress. For each portal hostname it
  sends `/api` to the matching `admin-api`, `hub-api`, or `orgs-api` over a
  dedicated private access network; all other paths go to the static portal.
- `mesh-api`: private `mesh` plus `backend`; no published port and no ingress.
- `mcp-server`: private `mcp_access` plus `backend`; Traefik can reach the
  network, but no MCP router is configured by default.
- `workers`: `backend` only and exactly one replica per tenant. Do not scale this
  service beyond one replica until task-level locking is implemented.

The shared JSON configuration has the same file-mount shape as a future
Kubernetes ConfigMap. The PostgreSQL password remains a separate secret mount;
only its file path appears in the JSON.

## MCP publication

Do not make MCP public merely by attaching it to `ingress`. Once OAuth/TLS and
request policy are implemented, add a dedicated hostname router to the tenant's
`traefik.json` whose service URL is `http://mcp-server:8080`. The existing
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
secrets. Migrations connect as `POSTGRES_USER`; runtime services read the
application-password file configured for the DML-only `vetchium_app` role, so
neither password appears in the JSON or service environment variables.

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

Application services roll start-first. The workers and PostgreSQL roll
stop-first. PostgreSQL remains a single instance on node-local storage, so add
tested off-host backups before production use.
