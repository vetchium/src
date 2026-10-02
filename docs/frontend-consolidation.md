# Frontend Consolidation: Global Hub and Orgs Portals

> **Status: research and accepted direction. Not implemented yet.**
>
> The evaluation took place with the product owner from 2026-09-30 to
> 2026-10-02.
>
> - The implementation plan and progress ledger are in
>   [`frontend-consolidation-plan.md`](frontend-consolidation-plan.md).
> - Until that plan's ledger shows completion, the current per-region portals
>   remain the implemented behavior, and `agent-guides/` remains
>   authoritative.

## 1. Decision

Hub and Orgs each become **one global static deployment**, independent of any
region:

| Portal | Host | Served by |
| --- | --- | --- |
| Hub | `https://vetchium.com` | A static-file host with managed TLS, for example Cloudflare Pages. |
| Orgs | `https://orgs.vetchium.com` | The same kind of static-file host. |
| Admin | `https://admin.<region>.vetchium.com` | **Unchanged.** Each region's VM, same origin as its `admin-api`. |

**Sign-in**

- The Hub and Orgs login pages ask for the region **before** the credentials.
- The region list is **hardcoded in the UI**.
- The choice is remembered per browser.
- A wrong region gets the same generic "invalid credentials" failure as a
  wrong password. No other region and no global service is consulted.
- An Org login that names a domain homed in another region keeps the existing
  "homed elsewhere" answer, carrying a region id. The UI switches region
  in place. An Org domain is a business identifier, not personal data.

**APIs**

- Each region exposes `https://<region>.api.vetchium.com`, with
  `/api/hub/*` going to `hub-api` and `/api/orgs/*` to `orgs-api`.
- TLS is terminated by Traefik on that region's VM, with an ACME HTTP-01
  certificate. The browser calls it directly, cross-origin, using CORS.

**Public URLs**

- Profiles live at `https://vetchium.com/u/<handle>` and are shown by the
  viewer's own region, which reads remote profiles over the mesh as it does
  today.
- `https://vetchium.com/org/<domain>` is reserved for future Org information
  served through the Hub APIs. Openings may follow the same pattern.
- **No profile page is indexable for now:**
  - every `/u/*` and `/org/*` response carries `X-Robots-Tag: noindex`;
  - the pages also carry `<meta name="robots" content="noindex">`;
  - `robots.txt` does not disallow these paths, because a crawler must fetch
    a page to see its `noindex`.

**Email links**

- Every link uses the global host and carries the region, for example
  `https://vetchium.com/reset-password?region=deu&token=…`.
- Emails are still sent by the home region.

**Not live yet:** no compatibility redirects from the old `hub.<region>` and
`orgs.<region>` hosts.

## 2. Why the API is not on the same origin as the UI

A same-origin API (`vetchium.com/api/<region>/…`) would avoid CORS
preflights. It was rejected, for these reasons:

- **DNS cannot route by path.** Serving `/api/<region>` from `vetchium.com`
  needs a reverse proxy at `vetchium.com` that decrypts the API traffic.
- **If that proxy is the static host's edge**, a third party terminates TLS on
  bearer tokens and personal data. That breaks the residency requirement:
  API traffic goes from the browser to our VM directly. It also brings the
  provider's edge-function quotas and costs.
- **If that proxy is ours**, `vetchium.com` must run on our VMs. A shared name
  served from every region needs a DNS-write credential on every VM, for the
  ACME DNS-01 challenge, and the same private key on every VM. Then one
  compromised region can hijack the domain or phish every region's users.
  That breaks region isolation.
- **A single proxy VM** would add a cross-border hop. It would also become a
  point of failure, and a decryption point for every region.

The cost of a separate API host is CORS. It is kept small in these ways:

- **Traefik answers preflights** through its headers middleware, so no Go
  code is involved.
- **`Access-Control-Max-Age: 86400`.** Chromium caps this at 2 hours. The
  result is at most one extra round trip per endpoint per two hours, and
  users are normally near their region.
- **CORS allows exactly one origin per API:** `https://vetchium.com` for
  `/api/hub` and `https://orgs.vetchium.com` for `/api/orgs`.
- **No credentials mode is needed.** Auth uses bearer tokens, not cookies, so
  there is no CSRF exposure.

Each API, media, and admin hostname resolves to exactly one VM, so the
HTTP-01 challenge works there. No DNS credential lives on any VM.

## 3. Data residency and sovereignty

| Data | Path |
| --- | --- |
| Credentials, session tokens, profiles, hiring data, all API traffic | Browser → chosen region only, over TLS terminated on our VM |
| Wrong-region sign-in attempt | Stays in the region the user picked |
| Static HTML/JS/CSS | Static host; no user data. The host sees visitor IPs and static URLs, which is accepted. |
| Profile pictures | Browser → owner's regional media origin (unchanged) |
| Global directory | Unchanged: handles, keyed email digests, Org domains |
| Emails | Sent by the home region's workers |

Because the region is chosen before any personal data is entered, **no
personal data reaches a region the user did not choose, or a third party.**

## 4. Evaluation

| Goal | Outcome |
| --- | --- |
| Money | **Neutral.** Static hosting is free or near-free at this scale. No VM shrinks: the Hub and Orgs nginx containers reserve 128 MiB per region and actually use a few MiB. TLS via ACME is free. |
| User experience | **Better.** One address per audience; links, QR codes, and emails on one domain; region chosen and remembered on the login page; faster first load far from a region; a clear message when a region is down. **Costs:** choosing a region on a new browser, CORS preflights, and the static host becoming one failure domain for all Hub and Orgs users. |
| Developer time | **Modest gain.** Dev and CI keep all four regions. Eight regional Hub and Orgs portal containers become two. One UI build serves every region. |
| Residency and sovereignty | **Preserved** (§3). |
| Security | API TLS stays region-isolated, and no DNS credential sits on any VM. **New trust point:** the static-host account and its deploy token can change the code every Hub and Orgs user runs. Protect it with hardware-key 2FA, CI-only deploys, and protected branches. Admin tokens never load code from the static host, because Admin stays regional. |

## 5. Consequences

- **Release discipline (expand, then contract).** One UI talks to every
  region, and regions are upgraded one at a time. So:
  1. Ship API additions to all regions first.
  2. Ship the UI that uses them.
  3. Remove the old behavior only after no UI depends on it.
- **Adding a region means rebuilding and republishing the Hub and Orgs
  portals,** because the region list, API origins, and media origins are
  compiled in.
- **The region catalog becomes server-side only.**
  - `signup-regions.json` stops carrying portal URLs.
  - The browser region-discovery APIs are removed if nothing else uses them.
  - The destination region stays authoritative for signup admission.
- **Per-region portal settings move into the UI's region table.** The Hub
  plans offered and the media origins are kept consistent with each region's
  `config.json` by a repository test.
  - The portal's fallback language becomes a single build-time default.
- **Not built in this change:**
  - Org information at `vetchium.com/org/<domain>` (route reserved only);
  - public openings URLs;
  - anonymous profile viewing;
  - search-engine indexing.

  Indexing later would need server-side rendering in the home region, never
  at the static host's edge.

## 6. What stays regional, and what stays private

- **Regional:**
  - `admin-ui` and every API;
  - `workers` and email sending;
  - PostgreSQL;
  - SeaweedFS and media.
- **Private:** `mesh-api` and `global-coordinator`, behind WireGuard and mTLS.
- **No global load balancer in front of APIs.** Each account lives in exactly
  one region, so "nearest region" routing would reach the wrong data.
