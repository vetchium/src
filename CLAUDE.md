# CLAUDE.md

This file provides guidance for Claude Code when working with the Vetchium codebase.

## Project Overview

Vetchium is a multi-region job search and hiring platform with distributed regional deployments. It supports multiple user types (Professionals/HubUsers, Employers/OrgUsers, Agencies/AgencyUsers) with regional data isolation and global coordination.

## Directory Structure

```
src/
├── api-server/          # Go backend API server
│   ├── cmd/             # Main entry point
│   ├── db/
│   │   ├── migrations/  # Goose migrations (global/ and regional/)
│   │   └── queries/     # SQL queries for sqlc
│   └── sqlc.yaml        # sqlc code generation config
├── hub-ui/              # React frontend (Vite + Ant Design)
├── specs/               # TypeSpec API specifications
│   └── typespec/        # Shared TypeSpec/TypeScript types
└── nginx/               # Load balancer configuration
```

## Tech Stack

- **Backend**: Go 1.25.2, sqlc for type-safe SQL
- **Frontend**: React 19, TypeScript 5.9, Bun, Vite, Ant Design
- **Database**: PostgreSQL 17 (1 global + 3 regional instances)
- **API Specs**: TypeSpec for contract-first development
- **Package Manager**: Bun (frontend), Go modules (backend)
- **Migrations**: Goose v3
- **Containers**: Docker Compose

## Build Commands

### Frontend (hub-ui/)

```bash
bun install          # Install dependencies
bun run dev          # Start dev server
bun run build        # Build for production
bun run lint         # Run ESLint
```

### Backend (api-server/)

```bash
go build -o api-server ./cmd/api-server.go    # Build binary
sqlc generate                                  # Generate SQL code
```

### Docker (from src/)

```bash
docker compose up --build    # Start all services
docker compose down          # Stop all services
```

### TypeSpec (specs/typespec/)

```bash
bun install
npx tsp compile .            # Generate TypeScript types
```

## Database Architecture

- **Global DB** (port 5432): Cross-region lookups, user identity, email hashes
- **Regional DBs**: IND1 (5433), USA1 (5434), DEU1 (5435) - PII and credentials

Migrations are in `api-server/db/migrations/{global,regional}/`.

## Development Conventions

### Code Style

- Use tabs for indentation
- LF line endings, UTF-8 encoding
- Trim trailing whitespace

### Specification-Driven Development

- Specs use markdown with imperative language
- Follow the template in `specs/` for new features
- Keep specs concise and precise - avoid fluff

### API Development

1. Define the API in TypeSpec (`specs/typespec/`)
2. Generate types for frontend and backend
3. Implement the endpoint in Go
4. Add SQL queries in `db/queries/` and regenerate with sqlc
