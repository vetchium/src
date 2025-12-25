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

## Frontend Architecture

### Directory Structure

All frontend applications (hub-ui, admin-ui, org-ui, agency-ui) follow this structure:

```
src/
├── components/     # Reusable UI components (buttons, modals, etc.)
├── pages/          # Page components corresponding to URL paths
├── forms/          # Form components with input fields and submission logic
├── contexts/       # React contexts (theme, auth, i18n)
├── hooks/          # Custom React hooks
├── locales/        # Translation files organized by language
│   ├── en-US/
│   │   ├── common.json
│   │   └── auth.json
│   ├── de-DE/
│   │   ├── common.json
│   │   └── auth.json
│   └── ta-IN/
│       ├── common.json
│       └── auth.json
├── config.ts       # API configuration
└── App.tsx         # Main app with providers
```

### Internationalization (i18n)

- Use `react-i18next` for translations
- **Supported Languages**: en-US (default), de-DE, ta-IN (BCP 47 tags)
- Translations organized by language directory, then by feature file
- Language preference:
  - Stored on server (via user preferences API) when authenticated
  - Cached locally for persistence across sessions
  - Falls back to browser locale or en-US

### Theme Management

- Support dark/light mode toggle using Ant Design's `ConfigProvider`
- Theme preference stored in localStorage (client-side only)
- Default: system preference or light mode

### Component Guidelines

- **Pages**: Handle routing, data fetching, layout. Import forms and components.
- **Forms**: Handle form state, validation, submission. Use Ant Design Form.
- **Components**: Stateless/minimal state, reusable across pages/forms.

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
- Implement tests for the API and UI as needed under the [playwright](./playwright/) directory with unique user for each test. Test exhaustively for all possible return codes and scenarios
- All .go files should be formatted by [goimports](https://pkg.go.dev/golang.org/x/tools/cmd/goimports)
- All .md, .ts, .tsx, .json, .yaml files should be formatted with [prettier](https://prettier.io/docs/)
- Prefer to use JSON instead of YAML wherever possible

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

## Testing

### Playwright Tests (playwright/)

Playwright is used for both API and UI testing across all portals.

```bash
cd playwright
npm install              # Install dependencies
npm test                 # Run all tests
npm run test:api         # Run API tests only
npm run test:api:admin   # Run admin API tests
```

**Prerequisites**: All Docker services must be running via `docker compose up` from `src/`.

### Test Architecture Principles

1. **Full Parallelization**: All tests run in parallel. Each test must be completely independent.

2. **Isolated Test Data**: Each test creates its own unique test data using UUID-based identifiers (e.g., `admin-{uuid}@test.vetchium.com`).

3. **No Test Data in Migrations**: Test users are created dynamically via the `lib/db.ts` helper, not in migration files. Migration files are used for production.

4. **Cleanup in Finally Blocks**: Always clean up test data in `finally` blocks or `afterEach` hooks to ensure cleanup even on test failures.

5. **Region Awareness**: The API runs behind a load balancer (`localhost:8080`) that routes to regional servers. Tests don't need to specify regions explicitly.

### Test File Organization

```
playwright/
├── lib/
│   ├── db.ts           # Database helpers (create/delete test users)
│   ├── api-client.ts   # Type-safe API client
│   └── mailpit.ts      # Email retrieval for TFA codes
└── tests/
    └── api/
        └── admin/      # Admin API tests
            ├── login.spec.ts
            ├── tfa.spec.ts
            └── logout.spec.ts
```

### Writing New Tests

```typescript
import { test, expect } from "@playwright/test";
import {
	createTestAdminUser,
	deleteTestAdminUser,
	generateTestEmail,
} from "../../../lib/db";
import { AdminAPIClient } from "../../../lib/api-client";

test("example test with isolated user", async ({ request }) => {
	const api = new AdminAPIClient(request);
	const email = generateTestEmail("my-test"); // Generates unique email
	const password = "Password123$";

	await createTestAdminUser(email, password);
	try {
		// Test logic here
		const response = await api.login(email, password);
		expect(response.status).toBe(200);
	} finally {
		// Always cleanup
		await deleteTestAdminUser(email);
	}
});
```

### Key Test Utilities

- `generateTestEmail(prefix)`: Creates unique email like `prefix-{uuid}@test.vetchium.com`
- `createTestAdminUser(email, password, status?)`: Creates admin in global DB
- `deleteTestAdminUser(email)`: Removes admin and cascades to sessions/tokens
- `getTfaCodeFromEmail(email)`: Waits for and extracts 6-digit TFA code from mailpit
