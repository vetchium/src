# Staging

Run the whole platform on one machine, reachable over TLS on real subdomains via a
laptop tunnel. Unlike the dev stack, it's production-like: images are pulled from
GHCR, one real admin is bootstrapped (no dev-seed), email is delivered by an
in-stack SMTP server (no mailpit), and the UIs are static gzipped builds. Everything lives in this
`staging/` directory.

## 1. Configure

```bash
cp staging/.env.example staging/.env
# fill the secrets: STAGING_ADMIN_*, DB_PASSWORD, S3_*. Email is delivered by an
# internal SMTP server, so nothing is required for it to work — set SMTP_SMARTHOST_*
# only to relay through an upstream (direct-to-MX from a laptop is often rejected).
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
[`../specs/production-deployment.md`](../specs/production-deployment.md).

## 4. Run

```bash
staging/up.sh                 # pull images + start
staging/cloudflared/run.sh    # start the tunnel (foreground; Ctrl-C to stop)
```

Open `https://hub-staging.vetchium.com` (also `org-staging`, `admin-staging`). Log
in as `STAGING_ADMIN_EMAIL`; the TFA code is emailed via the in-stack mail server. New hub/org
users sign up normally.

## Stop / reset

```bash
staging/down.sh               # stop, keep DB data
staging/down.sh --wipe        # stop and wipe the DBs
```

## Hostnames → local ports (for whichever edge you use)

```
hub-staging    8095      api-staging     8092 (-> ind1)
org-staging    8096      global-staging  8091
admin-staging  8097      in/us/de-staging  8092 / 8093 / 8094
```

To update: re-run `staging/build-push.sh`, then `staging/up.sh`.
