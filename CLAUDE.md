# CLAUDE.md

This file provides guidance for Claude Code when working with the Vetchium codebase.

## Project Overview

Vetchium is a multi-region job search and hiring platform with distributed regional deployments. It supports multiple user types (Professionals/HubUsers, Employers/OrgUsers, Agencies/AgencyUsers) with regional data isolation and global coordination.

## Tech Stack

- **Backend**: Go, sqlc for type-safe SQL
- **Frontend**: React, TypeScript, Bun, Vite, Ant Design
- **Database**: PostgreSQL (1 global + 3 regional instances)
- **API Specs**: TypeSpec for contract-first development
- **Package Manager**: Bun (frontend), Go modules (backend)
- **Migrations**: Goose v3
- **Containers**: Docker Compose

## Build Commands

### TypeSpec (specs/typespec/)

```bash
bun install
tsp compile .            # Generate OpenAPI specs
```

### Frontend (hub-ui/)

```bash
bun install          # Install dependencies
bun run dev          # Start dev server
bun run build        # Build for production
bun run lint         # Run ESLint
```

### Backend (api-server/)

```bash
sqlc generate                                    # Generate SQL code
go build -o api-server ./cmd/api-server.go       # Build binary
```

### Docker (from src/)

```bash
docker compose up --build       # Start all services
docker compose down -v          # Stop all services
```

## Database Architecture

- **Global DB**: Cross-region lookups, user identity, email hashes
- **Regional DBs**: PII, credentials, Actual data

Migrations are in `api-server/db/migrations/{global,regional}/`.

## Development Conventions

### Code Style

- LF line endings, UTF-8 encoding
- Trim trailing whitespace

### Development Process

- First write the Specifications under [specs](./specs/) by creating a new directory and a README.md file under that using the [specification template](./specs/spec-template-README.md)
- Document the required API endpoints and schemas under [typespec](./specs/typespec/) in appropriate `.ts` and `.go` files
- All the validations should happen on the [typespec](./specs/typespec/) in appropriate `.js` files and `.go` files
- Implement the backend and frontend code changes
- All the database related SQL should be under [db](./api-server/db/) directory on `.sql` files with reference for these on the `.go` code via [sqlc](./api-server/sqlc.yaml)
- No SQL statements should exist in `.go` files

### Handler Organization

Handlers are organized under `api-server/handlers/` in subdirectories based on API path and/or functionality:

- `handlers/hub/` - HubUser (Professional) handlers
- `handlers/org/` - OrgUser (Employer) handlers
- `handlers/agency/` - AgencyUser handlers

**Dependencies**: All handlers receive dependencies via `*server.Server` from `api-server/internal/server/server.go`. This struct contains:

- Database connections (Global, RegionalIND1, RegionalUSA1, RegionalDEU1)
- Logger (`*slog.Logger`)

**Handler Pattern**: Handlers are functions that take `*server.Server` and return `http.HandlerFunc`:

```go
func MyHandler(s *server.Server) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        s.Log.Info("handling request", "key", value)
        // handler logic using s.Global, s.GetRegionalDB(), etc.
    }
}
```

**Logging**: Use `slog` with structured key-value pairs:

```go
s.Log.Error("failed to query", "error", err)
s.Log.Info("user logged in", "user_id", userID)
```

**Registration** in `cmd/api-server.go`:

```go
mux.HandleFunc("POST /hub/endpoint", hub.MyHandler(s))
```
