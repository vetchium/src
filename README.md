# Vetchium

A multi-region application with global and regional databases.

## Architecture

- **1 Global Database**: Stores globally unique data (user handles, hashed emails)
- **3 Regional Databases**: Store regional user data (IND1, USA1, DEU1)
- **3 API Server Replicas**: One per region, each connecting to all databases
- **1 Global API Server**: Runs background jobs for global database cleanup (expired tokens, sessions)
- **Load Balancer**: nginx distributing traffic across API servers
- **Hub UI**: Vite + React application for professionals
- **Admin UI**: React application for platform administration
- **Employer UI**: React application for employers (organizations)
- **Agency UI**: React application for recruitment agencies

## Prerequisites

- Docker and Docker Compose
- [Bun](https://bun.sh/) - JavaScript runtime and package manager
- [Go](https://go.dev/) - For backend development
- [goimports](https://pkg.go.dev/golang.org/x/tools/cmd/goimports) - **Required** for git pre-push hooks

```bash
# Install goimports
go install golang.org/x/tools/cmd/goimports@latest
```

For local development (optional):

- [sqlc](https://sqlc.dev/) - for IDE navigation through generated SQL code
- [goose](https://github.com/pressly/goose) - for creating new database migrations

```bash
# Install sqlc
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest

# Install goose
go install github.com/pressly/goose/v3/cmd/goose@latest
```

## Quick Start

```bash
docker compose -f docker-compose-full.json up --build
```

Access the services:

- Hub UI: http://localhost:3000
- Admin UI: http://localhost:3001
- Employer UI: http://localhost:3002
- Agency UI: http://localhost:3003
- API (load balanced): http://localhost:8080

## Stopping Services

```bash
# Stop all services
docker compose -f docker-compose-full.json down

# Stop and remove volumes (clears database data)
docker compose -f docker-compose-full.json down -v
```

## Local Frontend Development

For faster frontend iteration, run only the backend services in Docker and the frontend locally:

```bash
# Start backend services (databases, API servers, load balancer)
docker compose -f docker-compose-backend.json up --build

# In a separate terminal, run the frontend locally
cd admin-ui && bun dev     # Admin UI at http://localhost:3000
# or
cd hub-ui && bun dev       # Hub UI at http://localhost:5173
# or
cd employer-ui && bun dev  # Employer UI at http://localhost:3000
# or
cd agency-ui && bun dev    # Agency UI at http://localhost:3000
```

This approach provides hot module reloading and faster rebuild times compared to running frontends in containers.

## Development Tools

```bash
cd api-server

# Generate Go code from SQL (for IDE navigation)
sqlc generate

# Create a new migration
cd db/migrations/global # or regional
goose create migration_name sql
```

## Git Hooks & Code Formatting

The repository uses [Husky](https://typicode.github.io/husky/) to automatically enforce code formatting before pushing. Git hooks are set up automatically when you run:

```bash
bun install
```

### Pre-Push Hook

The pre-push hook checks code formatting for all files being pushed:

- **Prettier** checks: `.ts`, `.js`, `.jsx`, `.json`, `.md` files (auto-installed via `bun install`)
- **Goimports** checks: `.go` files (**must be installed separately**, see Prerequisites)

**Important**: The hook will **fail** if you're pushing `.go` files and `goimports` is not installed.

If formatting issues are found, the push will be blocked with a message like:

```
❌ Prettier check failed!
Run 'bun format' to fix formatting issues
```

### Fixing Formatting Issues

**Format all code (from project root):**

```bash
bun format              # Format ALL files (prettier + goimports)
bun format:check        # Check formatting without modifying
bun format:prettier     # Only JS/TS/JSON/MD files
bun format:go           # Only Go files
bun format:go:check     # Check Go files only
```

**Or format from subdirectories:**

```bash
cd admin-ui && bun run format:prettier
cd api-server && goimports -w ./path/to/file.go
```

## Running Tests

All tests should be run using the CI configuration which has appropriate token durations for testing:

```bash
# Start services
docker compose -f docker-compose-ci.json up --build

# In a separate terminal
cd playwright
npm install
npm test
```

The CI configuration uses shortened token durations to allow testing of token expiry scenarios:

- **TFA tokens**: 15 seconds
- **Session tokens**: 30 seconds
- **Signup tokens**: 30 seconds
- **Remember-me sessions**: 60 seconds
- **Cleanup interval**: 5 seconds

The token expiry tests (`token-expiry.spec.ts`) verify that expired tokens are properly rejected.

## Docker Compose Configurations

| File                          | Description                                            |
| ----------------------------- | ------------------------------------------------------ |
| `docker-compose-full.json`    | Full stack with UI frontends (development)             |
| `docker-compose-backend.json` | Backend only for local frontend development            |
| `docker-compose-ci.json`      | CI/testing with short token durations for expiry tests |

## Test Users

For development, the following test users are available (password: `Password123$`):

**Hub Users:**

- `testuser1@example.com` (region: ind1)
- `testuser2@example.com` (region: usa1)

**Admin Users:**

- `admin1@vetchium.com`
- `admin2@vetchium.com`

## Environment Variables

### Global API Server

The global API server runs background cleanup jobs. It only needs the global database connection.

| Variable                               | Default | CI Value | Description                                       |
| -------------------------------------- | ------- | -------- | ------------------------------------------------- |
| `GLOBAL_DB_CONN`                       | -       | -        | PostgreSQL connection string for global DB        |
| `LOG_LEVEL`                            | INFO    | DEBUG    | Log level (DEBUG, INFO, WARN, ERROR)              |
| `ADMIN_TFA_TOKEN_CLEANUP_INTERVAL`     | 1h      | 5s       | Cleanup interval for expired admin TFA tokens     |
| `ADMIN_SESSION_CLEANUP_INTERVAL`       | 1h      | 5s       | Cleanup interval for expired admin sessions       |
| `HUB_SIGNUP_TOKEN_CLEANUP_INTERVAL`    | 1h      | 5s       | Cleanup interval for expired hub signup tokens    |
| `ORG_SIGNUP_TOKEN_CLEANUP_INTERVAL`    | 1h      | 5s       | Cleanup interval for expired employer signup tokens |
| `AGENCY_SIGNUP_TOKEN_CLEANUP_INTERVAL` | 1h      | 5s       | Cleanup interval for expired agency signup tokens |

### Regional API Servers

Regional API servers handle HTTP requests and run regional background jobs. They need connections to all databases.

**Database Connections:**

| Variable                | Description                                       |
| ----------------------- | ------------------------------------------------- |
| `REGION`                | Region identifier (ind1, usa1, deu1)              |
| `GLOBAL_DB_CONN`        | PostgreSQL connection string for global DB        |
| `REGIONAL_DB_IND1_CONN` | PostgreSQL connection string for IND1 regional DB |
| `REGIONAL_DB_USA1_CONN` | PostgreSQL connection string for USA1 regional DB |
| `REGIONAL_DB_DEU1_CONN` | PostgreSQL connection string for DEU1 regional DB |

**Token Expiry Configuration:**

| Variable                     | Default | CI Value | Description                              |
| ---------------------------- | ------- | -------- | ---------------------------------------- |
| `ADMIN_TFA_TOKEN_EXPIRY`     | 10m     | 15s      | Admin TFA token validity duration        |
| `ADMIN_SESSION_TOKEN_EXPIRY` | 24h     | 30s      | Admin session token validity duration    |
| `HUB_TFA_TOKEN_EXPIRY`       | 10m     | 15s      | Hub user TFA token validity duration     |
| `HUB_SESSION_TOKEN_EXPIRY`   | 24h     | 30s      | Hub user session token validity          |
| `HUB_SIGNUP_TOKEN_EXPIRY`    | 24h     | 30s      | Hub signup token validity duration       |
| `HUB_REMEMBER_ME_EXPIRY`     | 365d    | 60s      | Hub remember-me session validity         |
| `ORG_TFA_TOKEN_EXPIRY`       | 10m     | 15s      | Employer TFA token validity duration     |
| `ORG_SESSION_TOKEN_EXPIRY`   | 24h     | 30s      | Employer session token validity duration |
| `ORG_SIGNUP_TOKEN_EXPIRY`    | 24h     | 30s      | Employer signup token validity duration  |
| `ORG_REMEMBER_ME_EXPIRY`     | 365d    | 60s      | Employer remember-me session validity    |
| `AGENCY_TFA_TOKEN_EXPIRY`    | 10m     | 15s      | Agency TFA token validity duration       |
| `AGENCY_SESSION_TOKEN_EXPIRY` | 24h    | 30s      | Agency session token validity duration   |
| `AGENCY_SIGNUP_TOKEN_EXPIRY` | 24h     | 30s      | Agency signup token validity duration    |
| `AGENCY_REMEMBER_ME_EXPIRY`  | 365d    | 60s      | Agency remember-me session validity      |

**Regional Cleanup Configuration:**

| Variable                            | Default | CI Value | Description                                    |
| ----------------------------------- | ------- | -------- | ---------------------------------------------- |
| `HUB_TFA_TOKEN_CLEANUP_INTERVAL`    | 1h      | 5s       | Cleanup interval for expired hub TFA tokens    |
| `HUB_SESSION_CLEANUP_INTERVAL`      | 1h      | 5s       | Cleanup interval for expired hub sessions      |
| `ORG_TFA_TOKEN_CLEANUP_INTERVAL`    | 1h      | 5s       | Cleanup interval for expired employer TFA tokens |
| `ORG_SESSION_CLEANUP_INTERVAL`      | 1h      | 5s       | Cleanup interval for expired employer sessions |
| `AGENCY_TFA_TOKEN_CLEANUP_INTERVAL` | 1h      | 5s       | Cleanup interval for expired agency TFA tokens |
| `AGENCY_SESSION_CLEANUP_INTERVAL`   | 1h      | 5s       | Cleanup interval for expired agency sessions   |

**Email Configuration:**

| Variable                     | Default | Description                   |
| ---------------------------- | ------- | ----------------------------- |
| `SMTP_HOST`                  | -       | SMTP server hostname          |
| `SMTP_PORT`                  | -       | SMTP server port              |
| `SMTP_FROM_ADDRESS`          | -       | From email address            |
| `SMTP_FROM_NAME`             | -       | From name for emails          |
| `EMAIL_WORKER_POLL_INTERVAL` | 10s     | Email worker polling interval |
