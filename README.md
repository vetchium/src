# Vetchium

A multi-region application with global and regional databases.

## Architecture

- **1 Global Database**: Stores globally unique data (user handles, hashed emails)
- **3 Regional Databases**: Store regional user data (IND1, USA1, DEU1)
- **3 API Server Replicas**: One per region, each connecting to all databases
- **Load Balancer**: nginx distributing traffic across API servers
- **Frontend**: Vite + React application

## Prerequisites

- Docker and Docker Compose

## Quick Start

```bash
docker compose up --build
```

Access the services:
- Frontend: http://localhost:3000
- API (load balanced): http://localhost:8080

## Services

| Service | Port | Description |
|---------|------|-------------|
| hub-ui | 3000 | Frontend application |
| api-lb | 8080 | Load balancer for API servers |
| api-server-ind1 | - | API server (India region) |
| api-server-usa1 | - | API server (USA region) |
| api-server-deu1 | - | API server (Germany region) |
| global-db | 5432 | Global PostgreSQL database |
| regional-db-ind1 | 5433 | Regional PostgreSQL (India) |
| regional-db-usa1 | 5434 | Regional PostgreSQL (USA) |
| regional-db-deu1 | 5435 | Regional PostgreSQL (Germany) |

## Database Migrations

Migrations run automatically via [goose](https://github.com/pressly/goose) before API servers start.

Migration files are located in:
- `api-server/db/migrations/global/` - Global database schema
- `api-server/db/migrations/regional/` - Regional database schema

## Development

### API Server

The Go API server uses:
- [sqlc](https://sqlc.dev/) for type-safe SQL queries
- [goose](https://github.com/pressly/goose) for database migrations
- [pgx](https://github.com/jackc/pgx) for PostgreSQL connectivity

sqlc code generation happens during Docker build.

### Frontend

The React frontend uses Vite and calls `/api/` to reach the backend through the nginx proxy.

## Stopping Services

```bash
# Stop all services
docker compose down

# Stop and remove volumes (clears database data)
docker compose down -v
```

## API Endpoints

### GET /
Returns health status from all connected databases.

**Response:**
```json
{
  "status": "ok",
  "region": "ind1",
  "global_db": 1,
  "regional_ind1": 1,
  "regional_usa1": 1,
  "regional_deu1": 1
}
```
