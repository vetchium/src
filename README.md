# Vetchium

A multi-region job search and hiring platform.

## Architecture

- **1 Global Database**: Stores routing data (user handles, hashed emails, home region)
- **3 Regional Databases**: Store PII and mutable user data (IND1, USA1, DEU1)
- **3 Regional API Servers**: Handle HTTP requests, one per region
- **3 Regional Workers**: Run background cleanup jobs per region
- **1 Global Service**: Runs background cleanup jobs for the global database
- **Load Balancer**: nginx distributing traffic across regional API servers
- **Hub UI**: Vite + React application for professionals
- **Admin UI**: React application for platform administration
- **Employer UI**: React application for employers (organizations)
- **Agency UI**: React application for recruitment agencies

## Prerequisites

- Docker and Docker Compose
- [Bun](https://bun.sh/) — JavaScript runtime and package manager
- [Go](https://go.dev/) — For backend development
- [goimports](https://pkg.go.dev/golang.org/x/tools/cmd/goimports) — **Required** for git pre-push hooks

```bash
# Install goimports
go install golang.org/x/tools/cmd/goimports@latest
```

For local development (optional):

- [sqlc](https://sqlc.dev/) — for IDE navigation through generated SQL code
- [goose](https://github.com/pressly/goose) — for creating new database migrations

```bash
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
go install github.com/pressly/goose/v3/cmd/goose@latest
```

## Quick Start

```bash
# Install git hooks (run once from repo root)
bun install

# Start all services
docker compose -f docker-compose-full.json up --build
```

Access the services:

| Service         | URL                   |
| --------------- | --------------------- |
| Hub UI          | http://localhost:3000 |
| Admin UI        | http://localhost:3001 |
| Employer UI     | http://localhost:3002 |
| Agency UI       | http://localhost:3003 |
| API (LB)        | http://localhost:8080 |
| Mailpit (webUI) | http://localhost:8025 |

## Stopping Services

```bash
# Stop all services
docker compose -f docker-compose-full.json down

# Stop and remove volumes (clears database data)
docker compose -f docker-compose-full.json down -v
```

## Local Frontend Development

Run only the backend services in Docker and the frontend locally for faster iteration:

```bash
# Start backend services (databases, API servers, load balancer)
docker compose -f docker-compose-backend.json up --build

# In a separate terminal, run the desired frontend locally
cd hub-ui      && bun install && bun dev   # Hub UI      at http://localhost:5173
cd admin-ui    && bun install && bun dev   # Admin UI    at http://localhost:5173
cd employer-ui && bun install && bun dev   # Employer UI at http://localhost:5173
cd agency-ui   && bun install && bun dev   # Agency UI   at http://localhost:5173
```

This provides hot module reloading and faster rebuild times.

## Development Tools

```bash
# Generate Go code from SQL (for IDE navigation)
cd api-server && sqlc generate

# Create a new database migration
cd api-server/db/migrations/global   # or regional
goose create migration_name sql
```

## Code Formatting

The repository uses [Husky](https://typicode.github.io/husky/) to enforce formatting before pushes. Git hooks are set up when you run `bun install` at the repo root.

### Pre-Push Hook

- **Prettier** — `.ts`, `.tsx`, `.js`, `.jsx`, `.json`, `.yaml`, `.yml`, `.md` files
- **goimports** — `.go` files (must be installed separately, see Prerequisites)

### Format Commands

Run from the repo root:

```bash
bun run format              # Format all files (prettier + goimports)
bun run format:check        # Check formatting without modifying
bun run format:prettier     # Only JS/TS/JSON/MD files
bun run format:go           # Only Go files
bun run format:go:check     # Check Go files only
```

## Running Tests

All tests run against the CI Docker configuration which uses shortened token durations:

```bash
# Start services
docker compose -f docker-compose-ci.json up --build -d

# In a separate terminal
cd playwright
npm install
npm test                 # All tests
npm run test:api         # API tests only
npm run test:api:admin   # Admin API tests only
```

The CI configuration uses short token durations to enable expiry scenario tests:

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

**Hub Users:**

| Email                   | Region | Handle    |
| ----------------------- | ------ | --------- |
| `testuser1@example.com` | ind1   | testuser1 |
| `testuser2@example.com` | usa1   | testuser2 |

**Admin Users:**

| Email                 | Roles                                                              |
| --------------------- | ------------------------------------------------------------------ |
| `admin1@vetchium.com` | `admin:invite_users`, `admin:manage_users`, `admin:manage_domains` |
| `admin2@vetchium.com` | `admin:invite_users`                                               |

## Project Structure

```
src/
├── api-server/          # Go backend
│   ├── cmd/             # Entry points
│   ├── db/
│   │   ├── migrations/  # Goose migrations (global/ and regional/)
│   │   ├── queries/     # sqlc SQL queries
│   │   └── dev-seed/    # Seed data for development
│   ├── handlers/        # HTTP handlers (admin/, hub/, org/, agency/)
│   └── internal/server/ # Server struct and dependencies
├── specs/typespec/      # API contract (TypeSpec + hand-maintained .ts/.go types)
├── hub-ui/              # Professional portal (React + Vite)
├── admin-ui/            # Admin portal (React + Vite)
├── employer-ui/         # Employer portal (React + Vite)
├── agency-ui/           # Agency portal (React + Vite)
└── playwright/          # API and UI tests
    ├── lib/             # Shared helpers (db.ts, api-client.ts, mailpit.ts)
    └── tests/api/       # API test specs (admin/, hub/, org/, agency/)
```

## Development Workflow

1. Define the API contract in `specs/typespec/` (`.tsp`, `.ts`, and `.go` files)
2. Implement the backend handler in `api-server/handlers/`
3. Add SQL queries to `api-server/db/queries/` and run `sqlc generate`
4. Implement UI changes in the relevant `*-ui/` directory
5. Write Playwright tests in `playwright/tests/api/`

See [CLAUDE.md](./CLAUDE.md) for detailed conventions, patterns, and architecture decisions.

## Environment Variables

### Global Service

| Variable                               | Default | CI Value | Description                                       |
| -------------------------------------- | ------- | -------- | ------------------------------------------------- |
| `GLOBAL_DB_CONN`                       | —       | —        | PostgreSQL connection string for global DB        |
| `LOG_LEVEL`                            | INFO    | DEBUG    | Log level (DEBUG, INFO, WARN, ERROR)              |
| `ADMIN_TFA_TOKEN_CLEANUP_INTERVAL`     | 1h      | 5s       | Cleanup interval for expired admin TFA tokens     |
| `ADMIN_SESSION_CLEANUP_INTERVAL`       | 1h      | 5s       | Cleanup interval for expired admin sessions       |
| `HUB_SIGNUP_TOKEN_CLEANUP_INTERVAL`    | 1h      | 5s       | Cleanup interval for expired hub signup tokens    |
| `ORG_SIGNUP_TOKEN_CLEANUP_INTERVAL`    | 1h      | 5s       | Cleanup interval for expired org signup tokens    |
| `AGENCY_SIGNUP_TOKEN_CLEANUP_INTERVAL` | 1h      | 5s       | Cleanup interval for expired agency signup tokens |

### Regional API Servers

**Database connections:**

| Variable                | Description                                       |
| ----------------------- | ------------------------------------------------- |
| `REGION`                | Region identifier (ind1, usa1, deu1)              |
| `GLOBAL_DB_CONN`        | PostgreSQL connection string for global DB        |
| `REGIONAL_DB_IND1_CONN` | PostgreSQL connection string for IND1 regional DB |
| `REGIONAL_DB_USA1_CONN` | PostgreSQL connection string for USA1 regional DB |
| `REGIONAL_DB_DEU1_CONN` | PostgreSQL connection string for DEU1 regional DB |

**Token expiry:**

| Variable                      | Default | CI Value | Description                              |
| ----------------------------- | ------- | -------- | ---------------------------------------- |
| `ADMIN_TFA_TOKEN_EXPIRY`      | 10m     | 15s      | Admin TFA token validity duration        |
| `ADMIN_SESSION_TOKEN_EXPIRY`  | 24h     | 30s      | Admin session token validity duration    |
| `HUB_TFA_TOKEN_EXPIRY`        | 10m     | 15s      | Hub user TFA token validity duration     |
| `HUB_SESSION_TOKEN_EXPIRY`    | 24h     | 30s      | Hub user session token validity          |
| `HUB_SIGNUP_TOKEN_EXPIRY`     | 24h     | 30s      | Hub signup token validity duration       |
| `HUB_REMEMBER_ME_EXPIRY`      | 365d    | 60s      | Hub remember-me session validity         |
| `ORG_TFA_TOKEN_EXPIRY`        | 10m     | 15s      | Employer TFA token validity duration     |
| `ORG_SESSION_TOKEN_EXPIRY`    | 24h     | 30s      | Employer session token validity duration |
| `ORG_SIGNUP_TOKEN_EXPIRY`     | 24h     | 30s      | Employer signup token validity duration  |
| `ORG_REMEMBER_ME_EXPIRY`      | 365d    | 60s      | Employer remember-me session validity    |
| `AGENCY_TFA_TOKEN_EXPIRY`     | 10m     | 15s      | Agency TFA token validity duration       |
| `AGENCY_SESSION_TOKEN_EXPIRY` | 24h     | 30s      | Agency session token validity duration   |
| `AGENCY_SIGNUP_TOKEN_EXPIRY`  | 24h     | 30s      | Agency signup token validity duration    |
| `AGENCY_REMEMBER_ME_EXPIRY`   | 365d    | 60s      | Agency remember-me session validity      |

### Regional Workers

| Variable                            | Default | CI Value | Description                                      |
| ----------------------------------- | ------- | -------- | ------------------------------------------------ |
| `HUB_TFA_TOKEN_CLEANUP_INTERVAL`    | 1h      | 5s       | Cleanup interval for expired hub TFA tokens      |
| `HUB_SESSION_CLEANUP_INTERVAL`      | 1h      | 5s       | Cleanup interval for expired hub sessions        |
| `ORG_TFA_TOKEN_CLEANUP_INTERVAL`    | 1h      | 5s       | Cleanup interval for expired employer TFA tokens |
| `ORG_SESSION_CLEANUP_INTERVAL`      | 1h      | 5s       | Cleanup interval for expired employer sessions   |
| `AGENCY_TFA_TOKEN_CLEANUP_INTERVAL` | 1h      | 5s       | Cleanup interval for expired agency TFA tokens   |
| `AGENCY_SESSION_CLEANUP_INTERVAL`   | 1h      | 5s       | Cleanup interval for expired agency sessions     |

**Email:**

| Variable                     | Default | Description                   |
| ---------------------------- | ------- | ----------------------------- |
| `SMTP_HOST`                  | —       | SMTP server hostname          |
| `SMTP_PORT`                  | —       | SMTP server port              |
| `SMTP_FROM_ADDRESS`          | —       | From email address            |
| `SMTP_FROM_NAME`             | —       | From name for emails          |
| `EMAIL_WORKER_POLL_INTERVAL` | 10s     | Email worker polling interval |
