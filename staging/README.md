# Staging Deployment (Cloudflare Tunnel)

Run the **whole platform on one machine**, reachable over real TLS subdomains via a
laptop [Cloudflare tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/).
Unlike the dev stack, it's production-like: images are pulled from GHCR (built
manually — there is no CI), one real admin is bootstrapped (no dev-seed), and the
UIs are static gzipped nginx builds. Email is captured by an in-stack Mailpit (web
UI on host port 8025) rather than delivered outbound — direct SMTP to Gmail through
the Cloudflare tunnel is not reliable from this host. Everything lives in this
`staging/` directory, with its own `docker-compose.json`.

Each region is fronted by its own nginx "VM" container (`vm-global`, `vm-ind1`,
`vm-usa1`, `vm-deu1`) published on a host port. The host-installed `cloudflared`
daemon maps each public hostname to one of those ports, so the request path is:

```
browser → Cloudflare edge (TLS) → cloudflared (host) → nginx VM → app
```

which is identical to production minus the (disposable) Cloudflare edge.

## 1. Configure

```bash
cp staging/.env.example staging/.env
# fill the secrets: STAGING_ADMIN_*, DB_PASSWORD, S3_*, GARAGE_RPC_SECRET. Email is
# captured by an in-stack Mailpit (web UI on host port 8025); nothing is delivered
# outbound, so no mail config is needed.
```

## 2. Build & publish the images (manual — there is no CI)

```bash
gh auth token | docker login ghcr.io -u <your-gh-user> --password-stdin
staging/build-push.sh
```

## 3. Expose it

Default is a Cloudflare tunnel on your domain:

```bash
staging/cloudflared/setup-tunnel.sh   # one-time: browser login + DNS routes
```

Any edge that maps the hostnames below to the local ports works — for FOSS
alternatives (self-hosted frp/rathole, direct IPv6) see
[`../docs/runbooks/production-deployment.md`](../docs/runbooks/production-deployment.md).

## 4. Run

```bash
staging/up.sh                 # pull images + start
staging/cloudflared/run.sh    # start the tunnel (foreground; Ctrl-C to stop)
```

Open `https://hub-staging.vetchium.com` (also `org-staging`, `admin-staging`). Log
in as `STAGING_ADMIN_EMAIL`; the TFA code is captured by Mailpit — read it at
`https://mail-staging.vetchium.com` (or locally on host port 8025). New hub/org
users sign up normally and pick up their signup/TFA codes from the same Mailpit.

## Stop / reset

```bash
staging/down.sh               # stop, keep DB data
staging/down.sh --wipe        # stop and wipe the DB volumes
```

To update: re-run `staging/build-push.sh`, then `staging/up.sh`.

## Public hostname → host-port map

Single-level `<name>-staging.vetchium.com` subdomains are used so they fall under
Cloudflare's free Universal SSL (which covers `vetchium.com` + `*.vetchium.com`, but
not `*.staging.vetchium.com`).

| Hostname                      | Host port | Target                                  |
| ----------------------------- | --------- | --------------------------------------- |
| `hub-staging.vetchium.com`    | 8095      | hub-ui                                  |
| `org-staging.vetchium.com`    | 8096      | org-ui                                  |
| `admin-staging.vetchium.com`  | 8097      | admin-ui                                |
| `api-staging.vetchium.com`    | 8092      | "nearest regional VM" stand-in (→ ind1) |
| `global-staging.vetchium.com` | 8091      | vm-global (admin + global API)          |
| `in-staging.vetchium.com`     | 8092      | vm-ind1                                 |
| `us-staging.vetchium.com`     | 8093      | vm-usa1                                 |
| `de-staging.vetchium.com`     | 8094      | vm-deu1                                 |
| `mail-staging.vetchium.com`   | 8025      | mailpit web UI (captured email)         |

Mailpit's web UI is tunneled at `https://mail-staging.vetchium.com` (also on host
port 8025) so testers can read TFA / signup codes — outbound email is captured, not
delivered.
