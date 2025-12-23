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
docker compose up --build
```

Access the services:

- Hub UI: http://localhost:3000
- Admin UI: http://localhost:3001
- API (load balanced): http://localhost:8080

## Stopping Services

```bash
# Stop all services
docker compose down

# Stop and remove volumes (clears database data)
docker compose down -v
```

## Development Tools

```bash
cd api-server

# Generate Go code from SQL (for IDE navigation)
sqlc generate

# Create a new migration
cd db/migrations/global   # or regional
goose create migration_name sql
```

## Running Tests

```bash
cd playwright
npm install
npm test
```

Tests require all Docker services to be running (`docker compose up`).

## Test Users

For development, the following test users are available (password: `Password123$`):

**Hub Users:**
- `testuser1@example.com` (region: ind1)
- `testuser2@example.com` (region: usa1)

**Admin Users:**
- `admin1@vetchium.com`
- `admin2@vetchium.com`
