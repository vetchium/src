# Production deployment

One single-node Docker Swarm per region. A tenant stack runs PostgreSQL,
SeaweedFS (master, volume, filer, S3 gateway), Traefik, the Admin portal,
`admin-api`, `hub-api`, `orgs-api`, `mesh-api`, `mcp-server`, and `workers`.
`global-coordinator/stack.json` is a separate singleton with its own
PostgreSQL. The Hub and Orgs portals are static sites on a static-file host
([Global portals](#global-portals)).

Images come from the registry; nothing is built here. `signup-regions.json` is
the region catalog, mounted into `hub-api` and `orgs-api` for signup admission.

## Deploy a region

On the Linux host, after it has joined the WireGuard mesh:

```bash
cp .env.example .env && vi .env
make deploy REGION=sgp TAG=v1.2.3 IDENTITY_DIGEST_KEY_FILE=/path/to/identity_digest_key
```

The Makefile initializes Swarm and creates missing secrets: database
passwords, `<region>_admin_credential_key`, `<region>_orgs_credential_key`,
`<region>_mesh_credential`, and the three SeaweedFS S3 secrets. It runs
migrations before `docker stack deploy`; a failed migration leaves the running
stack untouched. Changing `config.json` or `traefik.json` rolls the services
that mount it.

| Variable | Notes |
| --- | --- |
| `TAG` | Required, immutable; `latest` and `dev` are rejected. |
| `POSTGRES_USER`, `POSTGRES_DB` | Required for a region. |
| `ACME_EMAIL` | Required; Let's Encrypt contact for this region's certificates. |
| `IDENTITY_DIGEST_KEY_FILE` | Required on first deploy; see below. |
| `REGISTRY` | Default `ghcr.io/vetchium`. |
| `HTTP_PORT`, `HTTPS_PORT` | Default `80`, `443`. |
| `PGSSLMODE` | Default `disable` until PostgreSQL TLS is configured. |
| `MESH_API_PORT` | Default `8443`; WireGuard peers only. |
| `GLOBAL_COORDINATOR_WIREGUARD_IP`, `MESH_API_WIREGUARD_IP`, `WIREGUARD_INTERFACE` | WireGuard addressing; deploy refuses to run if the interface is missing. |
| `MESH_CA_SECRET_NAME`, `MESH_*_SECRET_NAME` | Versioned names of the mesh certificate secrets. |
| `ADMIN_UI_DEFAULT_LANGUAGE` | `en-US`, `ta`, or `de-DE`. |

`HUB_UI_DEFAULT_LANGUAGE` and `ORGS_UI_DEFAULT_LANGUAGE` are obsolete; remove
them from `.env`.

## Deploy the coordinator

Once, on its WireGuard host:

```bash
make deploy-global-coordinator TAG=v1.2.3 \
  GLOBAL_POSTGRES_USER=global_admin GLOBAL_POSTGRES_DB=global_db
```

Its port is published in host mode: the host firewall must accept it on the
WireGuard interface only. Private DNS inside the mesh must resolve
`global-coordinator.internal` to `GLOBAL_COORDINATOR_WIREGUARD_IP` and each
`<region>.mesh.vetchium.com` to that region's `MESH_API_WIREGUARD_IP`. A region
deploy checks that its coordinator route uses the WireGuard interface.

## Secrets

- **Identity digest key.** `<region>_identity_digest_key` must be the same
  secret in every region; a different one silently stops global email
  uniqueness. It is created only from `IDENTITY_DIGEST_KEY_FILE`. The
  coordinator holds only its id: compute it and set `identityDigestKeyId` in
  `global-coordinator/config.json` before deploying or rotating (the
  placeholder is refused):

  ```bash
  secret=$(cat /path/to/identity_digest_key)
  root=$(printf 'vetchium-identity-digest-root\x00%s' "$secret" | openssl dgst -sha256 -binary | xxd -p -c 256)
  printf 'vetchium/identity-digest/key-id/v1' | \
    openssl dgst -sha256 -mac hmac -macopt hexkey:$root -binary | xxd -p -c 256 | cut -c1-16
  ```

- **SeaweedFS S3.** The gateway identity config and its access and secret keys
  are created together; a partial set stops deployment. Rotate all three
  together and roll the gateway and its clients (`hub-api`, `mesh-api`,
  `workers`) at once. The identity grants the `hub-profile-pictures`,
  `org-logos`, and `org-offer-letters` buckets; a region deployed before the
  last existed keeps its old grants, so rotate its S3 secrets once before
  rolling an image that stores offer letters.
- **Mesh certificates** (external): the CA bundle, the coordinator server and
  healthcheck key pairs, and a client and a server key pair per region's
  `mesh-api`. To rotate the CA: deploy a bundle with old and new CAs, roll leaf
  certificates one region at a time, then deploy the new-only bundle. Secrets
  are immutable, so use new versioned names each time.
- **Database passwords.** Changing a password secret does not change the role;
  rotate the PostgreSQL role and the secret as one operation.

## Configuration that must agree

- `hubAPIServer.signup.enabled` with the region's `signupEnabled` in
  `signup-regions.json`, and `orgsAPIServer.signup.enabled` with
  `orgSignupEnabled`. The APIs refuse to start on a mismatch. Change both, and
  republish the portals, whose region table carries the same flags.
- `hubAPIServer.offeredPlans` and `objectStorage.mediaBaseURL` with the
  region's entry in `hub-ui/src/app/regions/production.json`; the catalog with
  `portal-ui/src/regions/production.json`. The repository test
  `TestPortalRegionTablesMatchCheckedInConfiguration` checks this.
- `hubAPIServer.publicBaseURL` is `https://vetchium.com` and
  `orgsAPIServer.publicBaseURL` is `https://orgs.vetchium.com` in every region.
- Adding a Hub plan: migrate the database, deploy `hub-api` and `workers` from
  that release, then publish the Hub portal with the plan in its table.
- Payments are simulated in every environment, production included: anyone can
  take a paid plan without paying until a processor is integrated.

## Google sign-in for Gold Orgs

Dormant until configured: without `orgsAPIServer.googleSignIn` the region
answers `org-sso-not-available` and no Org can turn the feature on. The
repository ships no client ID, because the OAuth client belongs to the operator.

1. In Google Cloud, create an OAuth client of type **Web application** with
   the authorized redirect URI `https://orgs.vetchium.com/sso/google/callback`.
   One client serves every region: the portal is global and sends the user's
   region back to the right API.
2. Create the external secret `<region>_google_oidc_client_secret` from the
   client secret, and mount it in the `orgs-api` service as
   `google_oidc_client_secret`.
3. Add to each region's `orgsAPIServer` in `deploy/<region>/config.json`:

   ```json
   "googleSignIn": {
     "issuer": "https://accounts.google.com",
     "clientID": "<client id>.apps.googleusercontent.com",
     "clientSecretFile": "/run/secrets/google_oidc_client_secret",
     "redirectURI": "https://orgs.vetchium.com/sso/google/callback"
   }
   ```

   Leave out `discoveryURL`; it exists only for the development provider.
4. `orgs-api` fetches Google's discovery document, keys and token endpoint over
   HTTPS, so attach it to a network with outbound access. Create an overlay
   network `google_egress` (not `internal`, like `smtp_egress`), add it to
   `orgs-api`'s networks, and allow outbound TCP 443 from it to
   `accounts.google.com`, `oauth2.googleapis.com` and `www.googleapis.com`.
   The browser's own visit to Google is not routed through the region.

A Google Workspace administrator's 2-Step Verification is the second factor for
this sign-in, so Vetchium asks for no TOTP code. Rotate the client secret by
creating a new versioned secret and rolling `orgs-api`.

## Global portals

```bash
make portal-dist    # repository root; writes portal-dist/hub and portal-dist/orgs
```

Each directory has `_headers` (CSP, HSTS, immutable `/assets/`, `noindex` on
`/u/*` and `/org/*`) and `_redirects` (single-page fallback), in the format
Cloudflare Pages and Netlify read. The build fails if a development host leaks
into a bundle.

- **Static host:** two sites with custom domains `vetchium.com` and
  `orgs.vetchium.com`. Protect the account with hardware-key two-factor; its
  deploy token can change the code every Hub and Orgs user runs. Deploy only
  from CI on the protected default branch.
- **DNS (Gandi):** `vetchium.com` and `orgs.vetchium.com` point at the static
  host (the apex needs the provider's apex support; confirm first).
  `<region>.api.vetchium.com`, `media.<region>.vetchium.com`, and
  `admin.<region>.vetchium.com` are A/AAAA records for that region's host only,
  so its Traefik can answer the HTTP-01 challenge.
- **Firewall:** each region host accepts TCP 80 and 443 from anywhere; 80 stays
  open for renewals. Outbound UDP and TCP 53 from `dns_egress` to the
  configured `orgDomainVerification.resolverAddress`.
- **Release order:** deploy API additions to every region, then publish the
  portals that use them; remove old API behavior only when no published portal
  depends on it. Adding a region requires rebuilding both portals.

## First administrator

Production has no seeded accounts. Create the first administrator with the
Admin API's password hashing, then grant management while connected as the
migration owner:

```sql
INSERT INTO vetchium.admin_permissions (admin_user_id, permission)
SELECT admin_user_id, 'admin:manage_users'
FROM vetchium.admin_users
WHERE email_address = 'chosen-admin@example.com'
ON CONFLICT (admin_user_id, permission) DO NOTHING;
```

`admin:manage_users` implies `admin:view_users`. Use the same statement to
recover a region that lost its last manager.

## Operations

```bash
docker stack services sgp
docker service logs -f sgp_hub-api     # likewise admin-api, orgs-api, mesh-api, mcp-server, workers
docker service ps sgp_admin-api
```

Logs are structured JSON. `event=request_error`, `event=worker_job_error`, and
`event=process_exit` mark failures; expected 4xx is logged at warning.

- Application services roll start-first; workers, PostgreSQL, and SeaweedFS
  roll stop-first.
- Never scale `workers` beyond one replica; there is no task locking.
- PostgreSQL and SeaweedFS are single instances on node-local storage: set up
  tested, encrypted, off-host backups before production use.
- MCP has no public route. Publishing it needs OAuth, TLS, and request limits
  first, then a router in `traefik.json` to `http://mcp-server:8080`.

## SeaweedFS backup and restore

- Back up the master, volume, and filer volumes together with the region's
  PostgreSQL volume and the three S3 secrets, after quiescing profile writes
  and object deletion.
- Restore all of them from the same recovery point with writes and workers
  stopped. Start the S3 gateway, check that referenced objects read with signed
  requests and anonymous requests are denied, then resume.
- Never pair an empty object volume with old database references. A
  database-only or object-only restore needs reconciliation of missing and
  orphaned objects before reopening the region.

## Staging

One host runs every region, the coordinator, both global portals, and Mailpit
with Docker Compose from published images; nothing is built there.
Cloudflare Tunnel is the only ingress and the host publishes no ports. The
region project template is `staging/region.json`; the rest is
`staging/compose.json`.

| Host | Serves |
| --- | --- |
| `vetchium.com` | Hub portal |
| `orgs.vetchium.com` | Orgs portal |
| `<region>-api.vetchium.com` | the region's Hub and Orgs APIs |
| `<region>-media.vetchium.com` | the region's signed media |
| `<region>-admin.vetchium.com` | the region's Admin portal |
| `staging-mail.vetchium.com` | Mailpit, which receives all staging mail |

Regional names are flat because Cloudflare's Universal SSL certificate covers
one subdomain level. Staging occupies production's portal hosts; production
needs them back before launch.

Cloudflare terminates TLS, so it sees API traffic, tokens included: staging
holds test data only.

### Images

`make publish` (repository root) pushes every image under the checked-out
commit (`git-<commit>`, refused with uncommitted changes) or `TAG`, and moves
`latest` to them. It includes `hub-ui-staging` and `orgs-ui-staging`, compiled
with the staging region tables, and `wireguard-node`.

### Host

- Linux with the WireGuard kernel module, or Docker Desktop, whose VM kernel
  has it; Docker with Compose v2, make, and OpenSSL; about 8 GB of memory for
  Docker.
- `docker login ghcr.io` when the registry is private.
- Rotate container logs on Linux: `"log-driver": "local"` in
  `/etc/docker/daemon.json`.
- Networks use `10.232.0.0/16`, apart from the development and CI stacks'
  `10.231.0.0/16`; if that overlaps the host's networks, set
  `VETCHIUM_STAGING_NETWORK_OCTET` in `deploy/staging/.env` before the first
  deploy.

### Tunnel

Once, on the host:

```bash
cd deploy/staging && make secrets
```

On any machine with `cloudflared`:

```bash
cloudflared tunnel login
cloudflared tunnel create vetchium-staging
for host in $(sed -n 's/^  - hostname: //p' deploy/staging/cloudflared.yml); do
  cloudflared tunnel route dns --overwrite-dns vetchium-staging "$host"
done
```

Copy `~/.cloudflared/<tunnel-id>.json` to
`deploy/staging/.secrets/cloudflared_credentials.json` on the host and set
`CLOUDFLARE_TUNNEL_ID=<tunnel-id>` in `deploy/staging/.env`. A new hostname in
`cloudflared.yml` needs its own `route dns`.

In the Cloudflare dashboard:

- Protect `staging-mail.vetchium.com` and each `<region>-admin.vetchium.com`
  with a Zero Trust Access application for the team. Mailpit also asks for
  user `staging` and the password in `.secrets/mailpit_ui_password`.
- Turn off Rocket Loader, Email Address Obfuscation, and every other feature
  that injects scripts; the portals' CSP blocks them.

### Deploy

```bash
make staging          # repository root; deploys latest, or TAG=<tag>
make staging-clean    # stops staging and deletes its data
```

`deploy/staging/Makefile` creates missing secrets in `.secrets/`, derives the coordinator's
identity digest key id, pulls every image, and starts project
`vetchium-staging` (coordinator, portals, Mailpit, cloudflared), then
`vetchium-staging-<region>` for each region. Each database is migrated before
its project is replaced; a failed migration leaves that project running. It
prints the deployed images' tag, then every staging URL, where the Mailpit
password is, and short notes on mail, signup, administrators, and data;
`make -C deploy/staging info` prints that summary again.

- `.secrets/` and the Docker volumes belong together: the databases and object
  stores were initialized with those secrets. Back up or delete both; never
  delete `.secrets/` alone.
- `make staging-clean` removes every project's containers, networks, and
  volumes, keeping `.secrets/` and the tunnel; the next `make staging` starts
  empty. Meanwhile Cloudflare answers every staging host with its
  tunnel-unreachable error page. `make -C deploy/staging down` stops staging
  and keeps the data.
- Logs: `docker compose --project-name vetchium-staging-sgp logs -f hub-api`.
- After migrating each region, `make staging` creates `admin@<region>.test`
  with every permission and the password in `.secrets/<region>_admin_password`,
  unless that address already exists. Production keeps the manual
  [First administrator](#first-administrator) procedure: its Admin portals have
  no generated credential.
- Connect to a region's database with
  `docker compose --project-name vetchium-staging-<region> exec db psql -U vetchium_owner tenant_db`.
- `staging/<region>/config.json`, `staging/signup-regions.json`, and the
  staging region tables in `portal-ui`, `hub-ui`, and `orgs-ui` must agree;
  `TestPortalRegionTablesMatchCheckedInConfiguration` checks them.
