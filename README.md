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
- [sqlc](https://sqlc.dev/) if you want to navigate through sources in IDE

## Quick Start

```bash
docker compose up --build
```

Access the services:

- Frontend: http://localhost:3000
- API (load balanced): http://localhost:8080

## Stopping Services

```bash
# Stop all services
docker compose down

# Stop and remove volumes (clears database data)
docker compose down -v
```

## IDE support for navigation

```bash
$ cd api-server
$ sqlc generate
```

## Test Users

For development, the following test users are available:

- `testuser1@example.com` / `password1234` (region: ind1)
- `testuser2@example.com` / `password4567` (region: usa1)
