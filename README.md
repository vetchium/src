# Vetchium

A FOSS platform that is globally distributed and for Professional Networking, Jobs and Human Resources related operations

## Architecture

- **1 Global Database**: Stores routing data (user handles, hashed emails, home region)
- **3 Regional Databases**: Store PII and mutable user data (IND1, USA1, DEU1)
- **3 Regional API Servers**: Handle HTTP requests, one per region
- **3 Regional Workers**: Run background cleanup jobs per region
- **1 Global Service**: Runs background cleanup jobs for the global database
- **Load Balancer**: nginx distributing traffic across regional API servers
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

## Test / Seed Users

All seed users have password: `Password123$`

Hub users and org superadmins are created via APIs by the `seed-users` docker-compose
service (which calls the API and reads tokens from Mailpit). The SQL seed only covers
admin users and marketplace capabilities.

**Hub Users** — log in at http://localhost:3000 (primary email `@hub.example`; house-domain
emails are their work emails added separately via the profile):

| Email                            | Character          | House      | Region |
| -------------------------------- | ------------------ | ---------- | ------ |
| `harry.potter@hub.example`       | Harry Potter       | Gryffindor | ind1   |
| `hermione.granger@hub.example`   | Hermione Granger   | Gryffindor | usa1   |
| `ron.weasley@hub.example`        | Ron Weasley        | Gryffindor | deu1   |
| `neville.longbottom@hub.example` | Neville Longbottom | Gryffindor | ind1   |
| `draco.malfoy@hub.example`       | Draco Malfoy       | Slytherin  | usa1   |
| `pansy.parkinson@hub.example`    | Pansy Parkinson    | Slytherin  | deu1   |
| `luna.lovegood@hub.example`      | Luna Lovegood      | Ravenclaw  | deu1   |
| `cho.chang@hub.example`          | Cho Chang          | Ravenclaw  | ind1   |
| `cedric.diggory@hub.example`     | Cedric Diggory     | Hufflepuff | usa1   |
| `hannah.abbott@hub.example`      | Hannah Abbott      | Hufflepuff | ind1   |

**Org Superadmins** — log in at http://localhost:3002 (one per house company):

| Email                               | Company domain       | Region |
| ----------------------------------- | -------------------- | ------ |
| `harry.potter@gryffindor.example`   | `gryffindor.example` | ind1   |
| `draco.malfoy@slytherin.example`    | `slytherin.example`  | usa1   |
| `luna.lovegood@ravenclaw.example`   | `ravenclaw.example`  | deu1   |
| `cedric.diggory@hufflepuff.example` | `hufflepuff.example` | ind1   |

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
│   └── typespec/        # Source of truth for all API types
├── hub-ui/              # Professional portal (React + Bun)
├── org-ui/              # Org portal (React + Bun)
├── admin-ui/            # Admin portal (React + Bun)
└── playwright/          # API and UI tests
    ├── lib/             # Shared helpers (db.ts, api-client.ts, mailpit.ts)
    └── tests/api/       # API test specs (admin/, hub/, org/)
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
