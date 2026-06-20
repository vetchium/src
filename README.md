# Vetchium

A FOSS platform that is globally distributed and for Professional Networking, Jobs and Human Resources related operations

## Architecture

- **1 Global Database**: Stores routing data (user handles, hashed emails, home region)
- **3 Regional Databases**: Store PII and mutable user data (IND1, USA1, DEU1)
- **3 Regional API Servers**: Handle HTTP requests, one per region
- **3 Regional Workers**: Run background cleanup jobs per region
- **1 Global Service**: Serves the global + admin API and runs global background cleanup jobs
- **Object Storage**: One single-node [Garage](https://garagehq.deuxfleurs.fr/) (S3-compatible) instance per region, plus a global bucket on the IND1 node (tag icons and other global assets)
- **Load Balancer**: nginx distributing traffic across regional API servers
- **Mailpit**: In-stack SMTP sink — outbound email is captured, not delivered (web UI on port 8025)
- **Hub UI**: React application for professionals
- **Org UI**: React application for employers (organizations)
- **Admin UI**: React application for platform administration

## Prerequisites

- Docker and Docker Compose
- [Bun](https://bun.sh/) — JavaScript runtime and package manager
- [Go](https://go.dev/) — For backend development
- [goimports](https://pkg.go.dev/golang.org/x/tools/cmd/goimports) — **Required** for git pre-push hooks

```bash
go install golang.org/x/tools/cmd/goimports@latest
```

For local development (optional):

```bash
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest   # IDE navigation through generated SQL
go install github.com/pressly/goose/v3/cmd/goose@latest  # Creating new DB migrations
```

## Quick Start

```bash
# Install git hooks (run once from repo root)
bun install

# Start all services
docker compose -f docker-compose-full.json up --build

# Stop
docker compose -f docker-compose-full.json down

# Stop and wipe database volumes
docker compose -f docker-compose-full.json down -v
```

Access the services:

| Service         | URL                   |
| --------------- | --------------------- |
| Hub UI          | http://localhost:3000 |
| Admin UI        | http://localhost:3001 |
| Org UI          | http://localhost:3002 |
| API (LB)        | http://localhost:8080 |
| Mailpit (webUI) | http://localhost:8025 |

## Frontend Development

```bash
docker compose -f docker-compose-backend.json up --build
cd hub-ui && bun install && bun run dev
```

## Code Formatting

[Husky](https://typicode.github.io/husky/) enforces formatting on `git push` (set up by `bun install`).

```bash
bun run format              # Format all files (prettier + goimports)
bun run format:check        # Check without modifying
```

## Running Tests

```bash
# Start CI stack
docker compose -f docker-compose-ci.json up --build -d

# Run tests
cd playwright
npm install
npm run env:check        # Verify all services are healthy
CI=1 npm test            # All tests (API + UI)
CI=1 npm run test:api    # API tests only
CI=1 npm run test:ui     # UI tests (Chromium, 1 worker)
```

`CI=1` limits parallel workers (4 for API tests) for stability across the multi-service setup. UI tests are restricted to 1 worker to prevent Mailpit collisions.

### Exploratory UI test run (manual-style sweep)

Separate from `npm test`, there is a scripted **exploratory** sweep that drives the
real Hub and Org portals through headless Chromium — one isolated browser profile per
persona — co-ordinating an org, a staffing agency and several hub users through the full
hiring + marketplace + agency-referral journeys. Every step screenshots the screen and
records console errors / page errors / 4xx-5xx responses, so it surfaces **bugs,
usability problems, UI failures, RBAC mismatches and validation gaps** that the
assertion-based suite isn't looking for. It is **not** part of CI and asserts almost
nothing — a human reviews the screenshots and the captured-issue summary afterwards.

Unlike `npm test` (which runs on `docker-compose-ci.json` and seeds its own throwaway
data), this run uses **`docker-compose-full.json`** with its shared `seed-users`
Harry-Potter dataset (the same accounts listed under [Test / Seed Users](#test--seed-users)).
The scripts live under `playwright/exploratory/` as plain `.js` files outside `tests/`,
so `playwright test` / `npm test` never collects them — the two are fully independent.

```bash
# 1. Full stack + seed data (from src/)
docker compose -f docker-compose-full.json up --build -d
docker compose -f docker-compose-full.json logs -f seed-users   # wait for it to exit 0

# 2. Playwright + browser (from playwright/, once)
cd playwright && npm install && npx playwright install chromium

# 3. Run the sweep, then review screenshots + the captured-issue summary
./exploratory/run-all.sh
node exploratory/aggregate.js
open exploratory/output/shots/      # screenshots, in order
```

See [`playwright/exploratory/README.md`](./playwright/exploratory/README.md) for the
phase-by-phase breakdown, env vars (`HEADED=1`, `EXPLORE_OUT`, …) and notes. Findings
from the latest run are written up in [`specs/issues.md`](./specs/issues.md).

The CI stack uses short token durations to enable expiry scenario tests:

| Token type       | CI duration |
| ---------------- | ----------- |
| TFA tokens       | 15s         |
| Session tokens   | 30s         |
| Signup tokens    | 30s         |
| Remember-me      | 60s         |
| Cleanup interval | 5s          |

## Docker Compose Configurations

| File                          | Purpose                                                |
| ----------------------------- | ------------------------------------------------------ |
| `docker-compose-full.json`    | Full stack with UI frontends (development)             |
| `docker-compose-backend.json` | Backend only for local frontend development            |
| `docker-compose-ci.json`      | CI/testing with short token durations for expiry tests |

The `staging/` directory has its own `docker-compose.json` for the production-like
staging stack — see [Staging Deployment](#staging-deployment) below.

## Staging Deployment

The `staging/` directory runs the **whole platform on one machine**, reachable over
real TLS subdomains through a Cloudflare tunnel (or any edge you point at it).

See [`staging/README.md`](./staging/README.md) for the full setup, run, and
hostname→port reference, and [`specs/production-deployment.md`](./specs/production-deployment.md)
for FOSS edge alternatives (self-hosted frp/rathole, direct IPv6).

## Test / Seed Users

All seed users have password: `Password123$`

Hub users, org superadmins and the staffing agency are created via APIs by the
`seed-users` docker-compose service (which calls the API and reads tokens from Mailpit).
The SQL seed only covers admin users; the marketplace capabilities
(`staffing`, `background-verification`) ship in the global migration.

**Hub Users** — log in at http://localhost:3000:

| Email                  | Character          | House      | Region |
| ---------------------- | ------------------ | ---------- | ------ |
| `harry@hub.example`    | Harry Potter       | Gryffindor | ind1   |
| `hermione@hub.example` | Hermione Granger   | Gryffindor | usa1   |
| `ron@hub.example`      | Ron Weasley        | Gryffindor | deu1   |
| `neville@hub.example`  | Neville Longbottom | Gryffindor | ind1   |
| `draco@hub.example`    | Draco Malfoy       | Slytherin  | usa1   |
| `pansy@hub.example`    | Pansy Parkinson    | Slytherin  | deu1   |
| `luna@hub.example`     | Luna Lovegood      | Ravenclaw  | deu1   |
| `cho@hub.example`      | Cho Chang          | Ravenclaw  | ind1   |
| `cedric@hub.example`   | Cedric Diggory     | Hufflepuff | usa1   |
| `hannah@hub.example`   | Hannah Abbott      | Hufflepuff | ind1   |

**Org Superadmins** — log in at http://localhost:3002 (one per house company):

| Email                      | Company domain       | Region |
| -------------------------- | -------------------- | ------ |
| `admin@gryffindor.example` | `gryffindor.example` | ind1   |
| `admin@slytherin.example`  | `slytherin.example`  | usa1   |
| `admin@ravenclaw.example`  | `ravenclaw.example`  | deu1   |
| `admin@hufflepuff.example` | `hufflepuff.example` | ind1   |

**Gryffindor org members** (`gryffindor.example`, log in at http://localhost:3002) — invited by the seed in addition to the superadmin:

| Email                         | Character        | Roles                                                                        |
| ----------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| `harry@gryffindor.example`    | Harry Potter     | `manage_openings`, `manage_applications`, `view_users/addresses/costcenters` |
| `hermione@gryffindor.example` | Hermione Granger | `view_openings`, `view_applications`                                         |
| `ron@gryffindor.example`      | Ron Weasley      | `view_openings`, `view_applications`                                         |

**Staffing Agency** — log in at http://localhost:3002:

Floo Network Staffing is a recruitment agency that supplies applicants. The seed
creates the org, self-upgrades it to the **silver** plan (the free plan can't publish
listings), publishes a marketplace listing carrying the `staffing` and
`background-verification` capabilities, and subscribes `gryffindor.example` to it — so
the marketplace and agency-referrals flows have real data out of the box.

| Email                       | Company domain        | Region | Marketplace listing                |
| --------------------------- | --------------------- | ------ | ---------------------------------- |
| `admin@floonetwork.example` | `floonetwork.example` | ind1   | Staffing + Background Verification |

**Marketplace capabilities** — the canonical, deliberately-small set (seeded in the
global migration; the English `capability_id` is the stable tag, with `display_name` /
`description` translated into en-US, de-DE and ta-IN so consuming orgs can decide what a
provider offers):

| `capability_id`           | Meaning                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `staffing`                | Provider sources, screens and refers candidates into an org's openings (agency referrals). |
| `background-verification` | Pre-hire background checks (BGV): employment history, education and credentials.           |

**Admin Users** — log in at http://localhost:3001:

| Email                 | Roles                |
| --------------------- | -------------------- |
| `admin1@vetchium.com` | `admin:superadmin`   |
| `admin2@vetchium.com` | `admin:manage_users` |

## Project Structure

```
src/
├── api-server/          # Go backend
│   ├── cmd/             # Entry points
│   ├── db/
│   │   ├── migrations/  # Goose migrations (global/ and regional/)
│   │   ├── queries/     # sqlc SQL queries
│   │   └── dev-seed/    # Seed data for development
│   └── handlers/        # HTTP handlers (admin/, hub/, org/)
├── specs/               # Feature specs and TypeSpec API contracts
│   ├── typespec/        # Source of truth for all API types
│   └── financial-calculator.html # Interactive SaaS financial projection tool
├── hub-ui/              # Professional portal (React + Bun)
├── org-ui/              # Org portal (React + Bun)
├── admin-ui/            # Admin portal (React + Bun)
└── playwright/          # API and UI tests
    ├── lib/             # Shared helpers (db.ts, api-client.ts, mailpit.ts)
    ├── tests/api/       # API test specs (admin/, hub/, org/)
    └── exploratory/     # Manual-style UI sweep (separate from `npm test`) — see its README
```

## Development Workflow

1. **Write the spec** — run `/new-spec` in Claude Code; review and approve Stage 1, then run `/fill-spec` for the implementation plan
2. Add/update `.tsp` files under `specs/typespec/` and confirm API endpoints before proceeding
3. Implement backend handler in `api-server/handlers/`; add SQL queries and run `sqlc generate`
4. Implement UI changes in the relevant `*-ui/` directory
5. Write Playwright tests in `playwright/tests/api/`

See [CLAUDE.md](./CLAUDE.md) for detailed conventions, patterns, and architecture decisions.

See [ADD_NEW_REGION.md](./ADD_NEW_REGION.md) for the region architecture runbook.

## Architecture Decision Records

| ADR                                                    | Title                                       | Status   |
| ------------------------------------------------------ | ------------------------------------------- | -------- |
| [ADR-001](./specs/adr-001-multi-region-data-access.md) | Multi-Region Distributed Write Architecture | Accepted |
