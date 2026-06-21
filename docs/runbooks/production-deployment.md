# Production deployment & staging-edge options

How Vetchium is intended to run in production, and the FOSS options for fronting a
laptop staging environment (`staging/`). To actually run staging, see
[`staging/README.md`](../../staging/README.md).

Guiding principle: **the edge is disposable; everything below it is
production-faithful.** Staging swaps only the edge for a developer-friendly tunnel;
the layers below — per-VM nginx and app containers pulled from a registry — are
identical to production.

---

## 1. Production target topology

Four VMs, each shipped as **prebuilt containers pulled from GHCR** (never built on
the VM):

| VM        | Runs                                                        | Data                     |
| --------- | ----------------------------------------------------------- | ------------------------ |
| global    | `global-service` + nginx + global Postgres                  | identity/routing, admin  |
| ind1 (IN) | `regional-api-server` + `regional-worker` + nginx + ind1 DB | India PII / mutable data |
| usa1 (US) | same, usa1                                                  | US data                  |
| deu1 (DE) | same, deu1                                                  | EU data                  |

Routing: a user's region is encoded in their **session-token prefix**; any
regional VM can serve any user by connecting to the correct regional DB (ADR-001).
Geo steering exists for **latency + data residency**, not correctness. Future
regions slot in as additional regional VMs — see
[`add-new-region.md`](./add-new-region.md).

---

## 2. Image / registry model

- Images: `ghcr.io/vetchium/{migrate,regional-api-server,global-service,regional-worker,hub-ui,org-ui,admin-ui}`.
- Built and pushed **only** by `staging/build-push.sh`, run manually — **there is
  no CI**. Builds host-arch; for amd64 prod VMs from an arm laptop use
  `docker buildx build --platform linux/amd64 --push`.
- UI images use `Dockerfile.prod` (static nginx + gzip); the dev flow keeps each
  UI's plain `Dockerfile` (bun `serve.ts`).
- GHCR packages are **private**; prod VMs need a read:packages pull credential.
- The `vetchium` GHCR org also has codenamed images (`granger`, `hermione`, …) from
  another setup — reconcile naming before production.

---

## 3. Fronting a laptop staging environment

A residential laptop usually can't be reached inbound (CGNAT IPv4, and IPv6 often
absent or a non-routable ULA), so it needs **either** a routable public IP **or** a
tunnel to a host that has one. Options, FOSS-first:

### 3a. Direct exposure (no tunnel) — only if you have a real public IP

If the ISP delegates a **global** IPv6 (`2000::/3`, not `fd00::` ULA) and the
router allows inbound, run **Caddy** on the laptop terminating TLS via ACME
(Let's Encrypt, `DNS-01` so no inbound :80 needed), with `AAAA` records pointing at
the laptop. Fully FOSS, no third party. Caveats: IPv6-only reachability (clients
on IPv4-only networks can't connect), and dynamic prefixes need a DDNS updater.
Same idea works with a public IPv4 if you can port-forward (rare on CGNAT).

### 3b. Self-hosted tunnel to a small VPS — the FOSS recommendation

Put **frp** (or **rathole**) server on a cheap VPS with a public IP, the client on
the laptop, and **Caddy** on the VPS for ACME TLS. One client connection
multiplexes all the hostnames, over IPv4+IPv6, on your own domain, with no vendor
in the data path (you run all the software). Cost: a ~$4/mo VPS. This is the
closest FOSS equivalent to a Cloudflare tunnel and works regardless of the laptop's
IP situation.

### 3c. Cloudflare tunnel — convenience default (current `staging/cloudflared/`)

Free, no VPS, works over IPv4/IPv6, uses your domain. But it's a single hosted
vendor and is blocked/throttled in China/Russia, so treat it as a **disposable
staging edge only** — never the production answer.

Whichever you pick, the edge just maps the staging hostnames to local ports
8091–8097 (see `staging/README.md`).

---

## 4. Production edge — FOSS, cross-cloud, China/Russia-capable

> ⚠️ `vetchium.com`'s nameservers are currently on Cloudflare (the whole apex).
> Fine for the staging tunnel, but it puts the production apex on a single vendor.
> Before production, move the apex (or at least the prod hostnames) to the
> self-hosted GeoDNS below; keep only the `*-staging` records on Cloudflare.

- **Geo routing (replaces anycast):** authoritative **GeoDNS** you run — PowerDNS
  (geoip backend), CoreDNS (`geoip` plugin), or Knot — resolving `api.vetchium.com`
  to the nearest in-region VM. Run ≥2 nameservers across different clouds.
- **TLS:** per-VM **Caddy** (auto-ACME) or nginx + `certbot`/`lego`; multi-CA.
- **China / Russia:** in-country VMs with in-country authoritative DNS; an **ICP
  license** for China inside the GFW; **frp / rathole / WireGuard mesh** for private
  origins behind a public ingress node. Data residency is already enforced by the
  regional-DB design — this is about reachability.

---

## 5. Open decisions

- [ ] Choose the staging edge (§3) — Cloudflare now, frp/rathole+VPS for FOSS.
- [ ] Migrate the `vetchium.com` apex off Cloudflare to self-hosted GeoDNS (§4).
- [ ] Pick GeoDNS (PowerDNS vs CoreDNS) + ≥2 cross-cloud NS providers.
- [ ] Pick TLS (Caddy auto-ACME vs nginx+certbot).
- [ ] CN/RU ingress (frp / rathole / WireGuard); start the China ICP process.
- [ ] Reconcile GHCR image naming with the existing codenamed images.
- [ ] Secrets management for prod (DB/S3/SMTP credentials).
