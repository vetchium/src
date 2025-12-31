# Vetchium

A multi-region application with global and regional databases.

## Architecture

- **1 Global Database**: Stores globally unique data (user handles, hashed emails)
- **3 Regional Databases**: Store regional user data (IND1, USA1, DEU1)
- **3 API Server Replicas**: One per region, each connecting to all databases
- **Load Balancer**: nginx distributing traffic across API servers
- **Hub UI**: Vite + React application for professionals/employers
- **Admin UI**: React application for platform administration

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
docker compose -f docker-compose-full.yaml up --build
```

Access the services:

- Hub UI: http://localhost:3000
- Admin UI: http://localhost:3001
- API (load balanced): http://localhost:8080

## Stopping Services

```bash
# Stop all services
docker compose -f docker-compose-full.yaml down

# Stop and remove volumes (clears database data)
docker compose -f docker-compose-full.yaml down -v
```

## Local Frontend Development

For faster frontend iteration, run only the backend services in Docker and the frontend locally:

```bash
# Start backend services (databases, API servers, load balancer)
docker compose -f docker-compose-backend.yaml up --build

# In a separate terminal, run the frontend locally
cd admin-ui && bun dev   # Admin UI at http://localhost:3000
# or
cd hub-ui && bun dev     # Hub UI at http://localhost:5173
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

- **Prettier** checks: `.ts`, `.js`, `.jsx`, `.json`, `.yaml`, `.yml`, `.md` files (auto-installed via `bun install`)
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
bun format:prettier     # Only JS/TS/JSON/YAML/MD files
bun format:go           # Only Go files
bun format:go:check     # Check Go files only
```

**Or format from subdirectories:**

```bash
cd admin-ui && bun run format:prettier
cd api-server && goimports -w ./path/to/file.go
```

## Running Tests

```bash
cd playwright
npm install
npm test
```

Tests require all Docker services to be running (`docker compose -f docker-compose-full.yaml  up`).

## Test Users

For development, the following test users are available (password: `Password123$`):

**Hub Users:**

- `testuser1@example.com` (region: ind1)
- `testuser2@example.com` (region: usa1)

**Admin Users:**

- `admin1@vetchium.com`
- `admin2@vetchium.com`
