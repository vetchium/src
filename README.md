# Vetchium வெட்சியம்

![Vetchium V composed of multicolor Ixora flowers](V.png)

**Vetchium** draws its name from **வெட்சி** (_Vetchi_) in Tamil tradition:

- [**The Vetchi flower**](https://ta.wikipedia.org/wiki/%E0%AE%B5%E0%AF%86%E0%AE%9F%E0%AF%8D%E0%AE%9A%E0%AE%BF), identified with [Ixora](https://en.wikipedia.org/wiki/Ixora), a flowering shrub native to Southern India.
- [**வெட்சித் திணை** (_Vetchi thinai_)](https://ta.wikipedia.org/wiki/%E0%AE%B5%E0%AF%86%E0%AE%9F%E0%AF%8D%E0%AE%9A%E0%AE%BF%E0%AE%A4%E0%AF%8D_%E0%AE%A4%E0%AE%BF%E0%AE%A3%E0%AF%88), **`ஆநிரை கவர்தல் வெட்சி`** a theme in classical Tamil _puram_ poetry in which warriors seize Cattle (Wealth) from a rival land.

A professional networking and jobs platform. Each region (`sgp`, `usa1`, `deu`,
`ind1`) runs an isolated stack: database, object store, APIs, workers, and the
Admin portal. The Hub and Orgs portals are one static site each, shared by all
regions; the user picks the region at sign-in.

## Requirements

Docker with Compose, GNU Make, Go 1.27, Node.js 22.13 or newer. Optional:
[Tilt](https://tilt.dev).

## Run locally

```bash
make dev        # clean, then start the full stack with all four regions
make dev-seed   # clean, start the stack, then seed Hub users and Orgs
make clean      # stop everything and delete volumes and dev secrets
```

Generated database code (`backend/internal/db/sqlc/` and
`backend/internal/globaldb/sqlc/`) is not committed. `make dev`, `make backend`,
`tilt up`, and the test targets generate it; run `make sqlc` after changing SQL
queries or migrations so your editor sees the new code.

`make dev-seed` runs `make dev` itself, so it starts from a clean stack and can
be run at any time; do not run `make dev` first. It prints each seeded Hub
user's handle, email, region, and plan.

| What | URL |
| --- | --- |
| Hub portal | http://vetchium.localhost |
| Orgs portal | http://orgs.vetchium.localhost |
| Admin portal | http://admin-ui.`<region>`.localhost |
| Region API | http://`<region>`.api.vetchium.localhost |
| Mailpit (all outgoing mail) | http://127.0.0.1:18025 |

`EDGE_PORT` and `MAILPIT_PORT` change the published ports.

Tilt runs the same stack with per-service logs and incremental rebuilds:

```bash
tilt up                     # all regions
tilt up -- --tenants sgp    # one region (repeat the flag for more)
tilt up -- --manual         # build once, rebuild on demand
tilt down                   # stop; volumes and secrets survive
```

Every backend service builds from one Dockerfile, so a backend change rebuilds
all of them; use `--manual` or one region when that is too slow.

## Seeded accounts

Every seeded account uses the password `DevPassword123$`.

Admin portal, in every region (`<region>` is `sgp`, `usa1`, `deu`, or `ind1`):

| Email | Access | State |
| --- | --- | --- |
| `admin@<region>.example` | every Admin permission | active |
| `manager@<region>.example` (not in `deu`) | manage users, manage Hub signup domains | active |
| `viewer@<region>.example` | view users | active |
| `newcomer@<region>.example` | none | active |
| `retired@<region>.example` | view users | disabled |

Hub portal: eight users per region, listed in `dev/hub-seed-profiles/<region>.json`
(for example `wei.tan@sgp.example`). Half are on the Silver plan with full
profiles and pictures; half are on the free plan. Sign in with the matching
region selected.

Orgs portal: three Orgs per region, one on each plan: `<region>.example.com`
(Free), `silver.<region>.example.com`, and `gold.<region>.example.com`. Each has
`admin@` (Superadmin), `finance@` (Finance), `users@` (User manager), and
`member@` at its domain. A paid Org is on its plan with a simulated card.

Hub signup accepts addresses at `<region>.example`; `sgp` also accepts
`test1.example` to `test100.example`. Signup and reset emails arrive in Mailpit.

### Org signup domains

Org signup proves domain ownership with a DNS TXT record. In development and CI
the tenants skip that check for any domain ending in `.test` or `.example`
(`google.test`, `acme.example`): signup completes with no record published.
`example.com` and its subdomains, which the seeded Orgs use, and every other
domain still get the real lookup against the local `dns-dev` server. Production
never skips it.

## Test

```bash
make test             # every check, the CI stack, and all Playwright tests
make playwright-test  # only Playwright, with the same setup
make fmt              # apply every formatter
```

`make test` leaves the CI stack running for inspection and prints Go coverage
and API contract coverage. Narrower targets per area: `make test-go`,
`make typespec-check`, `make hub-ui-check`, `make orgs-ui-check`,
`make admin-ui-check`, `make portal-ui-check`, `make playwright-check`,
`make sql-check`.

## Publish

```bash
make docker                 # build every image
make publish TAG=v1.2.3     # build and push images
make portal-dist            # build the Hub and Orgs static sites into portal-dist/
```

Production deployment: [`deploy/README.md`](deploy/README.md).
