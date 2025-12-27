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

### Cross-Database Operations

When spanning global and regional databases, use compensating transactions (cannot use single transaction):

```go
// 1. Create in global DB first
err = s.Global.CreateRecord(ctx, params)
if err != nil {
    log.Error("failed to create record", "error", err)
    http.Error(w, "", http.StatusInternalServerError)
    return
}

// 2. Try regional operation
err = regionalDB.EnqueueEmail(ctx, emailParams)
if err != nil {
    log.Error("failed to enqueue email", "error", err)
    // Compensating transaction: delete what we just created
    if delErr := s.Global.DeleteRecord(ctx, id); delErr != nil {
        log.Error("failed to rollback", "error", delErr)
    }
    http.Error(w, "", http.StatusInternalServerError)
    return
}
```

### Cursor-Based Pagination

```go
// Query with limit+1 to detect if more results exist
rows, err := db.ListItems(ctx, ListItemsParams{
    Limit:  int32(limit + 1),
    Cursor: cursor,
})

hasMore := len(rows) > limit
if hasMore {
    rows = rows[:limit]
}

nextCursor := ""
if hasMore {
    lastRow := rows[len(rows)-1]
    nextCursor = base64.URLEncoding.EncodeToString([]byte(lastRow.SortKey))
}
```

### Standard Limits

| Item                     | Value      |
| ------------------------ | ---------- |
| TFA token expiry         | 10 minutes |
| Session token expiry     | 24 hours   |
| Pagination default limit | 50         |
| Pagination max limit     | 100        |

## Backend Conventions

### HTTP Response Conventions

| Scenario          | Status Code | Response Body                    |
| ----------------- | ----------- | -------------------------------- |
| Validation errors | 400         | JSON array: `[{field, message}]` |
| Unauthenticated   | 401         | Empty                            |
| Forbidden         | 403         | Empty                            |
| Not found         | 404         | Empty                            |
| Conflict          | 409         | Optional JSON                    |
| Invalid state     | 422         | Empty                            |
| Server error      | 500         | Empty                            |
| Created           | 201         | JSON resource                    |
| Deleted           | 204         | Empty                            |
| Success           | 200         | JSON                             |

### Handler Implementation Pattern

```go
func MyHandler(s *server.Server) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        ctx := r.Context()
        log := s.Logger(ctx)  // Always get logger from context

        // 1. Decode request body
        var req types.MyRequest
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
            log.Debug("failed to decode request", "error", err)
            http.Error(w, err.Error(), http.StatusBadRequest)
            return
        }

        // 2. Validate using TypeSpec-generated validator
        if errs := req.Validate(); len(errs) > 0 {
            log.Debug("validation failed", "errors", errs)
            w.WriteHeader(http.StatusBadRequest)
            json.NewEncoder(w).Encode(errs)
            return
        }

        // 3. Business logic with database calls
        result, err := s.Global.SomeQuery(ctx, params)
        if err != nil {
            if errors.Is(err, pgx.ErrNoRows) {
                w.WriteHeader(http.StatusNotFound)
                return
            }
            log.Error("failed to query", "error", err)
            http.Error(w, "", http.StatusInternalServerError)
            return
        }

        // 4. Check resource state if needed
        if result.Status != "active" {
            log.Debug("resource not active", "status", result.Status)
            w.WriteHeader(http.StatusUnprocessableEntity)
            return
        }

        // 5. Return success response
        log.Info("operation completed", "id", result.ID)
        json.NewEncoder(w).Encode(result)
    }
}
```

### Logging Conventions

Use `slog` with structured key-value pairs. Get logger from context:

```go
log := s.Logger(ctx)
```

Log levels:

- **Debug**: Validation failures, auth failures, expected/handled errors
- **Error**: Actual errors (DB failures, encoding errors, unexpected conditions)
- **Info**: Successful operations with relevant context (IDs, counts)

```go
log.Debug("invalid credentials - user not found")           // Expected failure
log.Debug("validation failed", "errors", validationErrors)  // Client error
log.Error("failed to query global DB", "error", err)        // Actual error
log.Info("admin login initiated", "admin_user_id", id)      // Success
```

### Handler Organization

Handlers are organized under `api-server/handlers/` in subdirectories based on API path and/or functionality:

- `handlers/admin/` - Admin handlers
- `handlers/hub/` - HubUser (Professional) handlers
- `handlers/org/` - OrgUser (Employer) handlers
- `handlers/agency/` - AgencyUser handlers

**Dependencies**: All handlers receive dependencies via `*server.Server` from `api-server/internal/server/server.go`. This struct contains:

- Database connections (Global, RegionalIND1, RegionalUSA1, RegionalDEU1)
- Logger (`*slog.Logger`)

### Middleware Structure

Middleware ordering in route registration:

1. **CORS** (outermost) - handles preflight requests
2. **RequestID** - injects logger with request_id into context
3. **Auth middleware** (route-specific) - validates session tokens

```go
// Routes WITHOUT auth (login, public endpoints)
mux.HandleFunc("POST /admin/login", admin.Login(s))

// Routes WITH auth (protected endpoints)
mux.Handle("POST /admin/protected",
    middleware.AdminAuth(s.Global)(http.HandlerFunc(admin.ProtectedHandler(s))))
```

Extract authenticated data in handlers:

```go
session := middleware.AdminSessionFromContext(ctx)
adminUser := middleware.AdminUserFromContext(ctx)
```

### Email Queue Pattern

Emails are queued asynchronously via regional database, not sent synchronously:

```go
err = regionalDB.EnqueueEmail(ctx, regionaldb.EnqueueEmailParams{
    EmailType:     regionaldb.EmailTemplateTypeAdminTfa,
    EmailTo:       recipient,
    EmailSubject:  templates.Subject(lang),
    EmailTextBody: templates.TextBody(lang, data),
    EmailHtmlBody: templates.HTMLBody(lang, data),
})
```

## API Naming Convention

API uses **snake_case** for all JSON fields:

- Request/response fields: `tfa_token`, `session_token`, `domain_name`, `created_at`
- Go struct tags: `json:"tfa_token"`
- TypeScript interfaces: `tfa_token: string`

```go
// Go struct
type Response struct {
    TFAToken  string `json:"tfa_token"`
    CreatedAt string `json:"created_at"`
}
```

```typescript
// TypeScript interface
interface Response {
	tfa_token: string;
	created_at: string;
}
```

## API endpoints Convention

Use POST as the method type as much as possible and pass any value needed in the request body with a schema. Avoid using path parameters. Query parameters should be sparingly used.
Use DELETE method for operations that may delete data. But ideally most APIs should be marking as disabled instead of delete.

Avoid using common endpoint prefixes to avoid wrong handlers getting called accidentally. For example, Instead of

```go
  mux.Handle("POST /admin/approved-domains", authMiddleware(admin.AddApprovedDomain(s)))
	mux.Handle("GET /admin/approved-domains", authMiddleware(admin.ListApprovedDomains(s)))
	mux.Handle("GET /admin/approved-domains/{domain}", authMiddleware(admin.GetApprovedDomain(s)))
  mux.Handle("DELETE /admin/approved-domains/{domain}", authMiddleware(admin.DeleteApprovedDomain(s)))
```

generate as below

```go
  mux.Handle("POST /admin/add-approved-domain", authMiddleware(admin.AddApprovedDomain(s)))
	mux.Handle("POST /admin/list-approved-domains", authMiddleware(admin.ListApprovedDomains(s)))
	mux.Handle("POST /admin/get-approved-domain", authMiddleware(admin.GetApprovedDomain(s)))
  mux.Handle("DELETE /admin/delete-approved-domains", authMiddleware(admin.DeleteApprovedDomain(s)))
```

## TypeSpec Validation

Types are defined in `specs/typespec/` under `.tsp` files and the corresponding `.ts` and `.go` files should also be updated. The `.tsp` compilation would generate only an openAPI spec and does NOT generate the Go or Typescript structs.

### TypeSpec Type Import Requirements

**CRITICAL**: All API request/response types MUST be imported from `specs/typespec/`. NEVER define API schemas locally in UI code, test code, or API client code.

#### Rules:

1. **All API types come from typespec** - Request types, response types, and field types must be imported from the typespec library
2. **No inline type definitions** - Never create inline objects or interfaces for API requests/responses
3. **No local type duplication** - Don't copy typespec types into local files
4. **Applies everywhere** - This rule applies to:
   - Frontend UI code (`hub-ui/`, `admin-ui/`, etc.)
   - Test code (`playwright/`)
   - API client code (`playwright/lib/api-client.ts`)
   - All TypeScript/JavaScript code that interacts with APIs

#### What's Allowed Locally:

- **Wrapper types** for non-API purposes (e.g., `APIResponse<T>` wrapper for test assertions)
- **UI-specific types** that don't represent API contracts (e.g., `Country` interface for dropdown options)
- **Component props** that aren't API request/response types

#### Examples:

**✅ CORRECT:**
```typescript
// Import from typespec
import type {
  HubLoginRequest,
  HubLoginResponse,
  CompleteSignupRequest,
} from "vetchium-specs/hub/hub-users";

// Use imported types
const loginRequest: HubLoginRequest = {
  email_address: email,
  password: password,
};

const response = await api.login(loginRequest);

// Function accepting typespec type
async function login(request: HubLoginRequest): Promise<HubLoginResponse> {
  // ...
}
```

**❌ WRONG:**
```typescript
// ❌ Don't define API types inline
const response = await api.login({
  email_address: email,
  password: password,
});

// ❌ Don't create local interfaces for API types
interface LoginRequest {
  email_address: string;
  password: string;
}

// ❌ Don't accept individual parameters instead of request objects
async function login(email: string, password: string) {
  // ...
}

// ❌ Don't define response shapes locally
interface LoginResponse {
  session_token: string;
}
```

#### Benefits:

1. **Single source of truth** - All API schemas defined once in typespec
2. **Type safety** - TypeScript catches mismatches at compile time
3. **Automatic propagation** - Schema changes automatically update everywhere
4. **No duplication** - Eliminates sync issues between definitions
5. **Better IDE support** - Full autocomplete and type hints from typespec

### TypeScript Validation Pattern

```typescript
// Type aliases for semantic types
export type AdminTFAToken = string;
export type TFACode = string;

// Constants matching .tsp constraints
export const TFA_CODE_LENGTH = 6;
const TFA_CODE_PATTERN = /^[0-9]{6}$/;

// Field validator (returns error message or null, no field context)
export function validateTFACode(code: TFACode): string | null {
	if (code.length !== TFA_CODE_LENGTH) {
		return ERR_TFA_CODE_INVALID_LENGTH;
	}
	if (!TFA_CODE_PATTERN.test(code)) {
		return ERR_TFA_CODE_INVALID_FORMAT;
	}
	return null;
}

// Request interface
export interface AdminTFARequest {
	tfa_token: AdminTFAToken;
	tfa_code: TFACode;
}

// Request validator (always named validate{TypeName})
export function validateAdminTFARequest(
	request: AdminTFARequest
): ValidationError[] {
	const errs: ValidationError[] = [];

	if (!request.tfa_token) {
		errs.push(newValidationError("tfa_token", ERR_REQUIRED));
	}

	const tfaCodeErr = validateTFACode(request.tfa_code);
	if (tfaCodeErr) {
		errs.push(newValidationError("tfa_code", tfaCodeErr));
	}

	return errs;
}
```

### Go Usage

Go types import from `vetchium-api-server.typespec/{package}` and have a `.Validate()` method:

```go
import "vetchium-api-server.typespec/admin"

var req admin.AdminTFARequest
// ... decode request ...
if errs := req.Validate(); len(errs) > 0 {
    w.WriteHeader(http.StatusBadRequest)
    json.NewEncoder(w).Encode(errs)
    return
}
```

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

### Auth Context Pattern

Auth state machine: `"login"` → `"tfa"` → `"authenticated"`

```typescript
// Handle specific HTTP status codes with appropriate error messages
switch (response.status) {
	case 400:
		setError(parseValidationErrors(body));
		break;
	case 401:
		setError(t("invalidCredentials"));
		break;
	case 403:
		setError(t("invalidCode"));
		break;
	case 422:
		setError(t("accountDisabled"));
		break;
	default:
		setError(t("serverError"));
}
```

Session stored in cookie: `vetchium_{app}_session` with 24h expiry, SameSite=Strict.

### API Client Pattern (Frontend)

Use native `fetch()` with explicit status code handling:

```typescript
const response = await fetch(`${API_BASE}/admin/login`, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ email, password }),
});

// Don't just check response.ok - handle each status explicitly
if (response.status === 200) {
	const data = await response.json();
	// success
} else if (response.status === 401) {
	// invalid credentials
} else if (response.status === 422) {
	// account disabled
}
```

For authenticated requests:

```typescript
headers: {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${sessionToken}`
}
```

## Development Conventions

### Code Style

- LF line endings, UTF-8 encoding
- Trim trailing whitespace

### Development Process

1. First write the Specifications under [specs](./specs/) by creating a new directory and a README.md file under that using the [specification template](./specs/spec-template-README.md)
2. Document the required API endpoints and schemas under [typespec](./specs/typespec/) in appropriate `.ts` and `.go` files
3. All the validations should happen on the [typespec](./specs/typespec/) in appropriate `.ts` files and `.go` files
4. Implement the backend and frontend code changes
   - **CRITICAL**: All API request/response types MUST be imported from `specs/typespec/`
   - NEVER define API types locally in UI code, test code, or API client code
   - API client methods must accept typespec request objects, not individual parameters
5. All the database related SQL should be under [db](./api-server/db/) directory on `.sql` files with reference for these on the `.go` code via [sqlc](./api-server/sqlc.yaml)
6. No SQL statements should exist in `.go` files
7. Implement tests for the API and UI as needed under the [playwright](./playwright/) directory with unique user for each test
   - **CRITICAL**: Import all request/response types from `specs/typespec/` in test files
   - Use typed request objects when calling API client methods
   - Test exhaustively for all possible return codes and scenarios
8. All .go files should be formatted by [goimports](https://pkg.go.dev/golang.org/x/tools/cmd/goimports)
9. All .md, .ts, .tsx, .json, .yaml files should be formatted with [prettier](https://prettier.io/docs/)
10. Prefer to use JSON instead of YAML wherever possible

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

### Required Test Scenarios

Every API endpoint test MUST cover these scenarios:

| Scenario                | Expected Status | Example                            |
| ----------------------- | --------------- | ---------------------------------- |
| Success case            | 200/201/204     | Valid request with valid auth      |
| Missing required fields | 400             | `{ password: "..." }` (no email)   |
| Invalid field format    | 400             | Invalid email format, wrong length |
| Empty string fields     | 400             | `{ email: "", password: "..." }`   |
| Boundary conditions     | 400             | Min/max length violations          |
| Non-existent resource   | 401 or 404      | Unknown user, invalid token        |
| Wrong credentials/code  | 401 or 403      | Wrong password, wrong TFA code     |
| Disabled/invalid state  | 422             | Disabled user account              |
| Expired tokens          | 401             | Expired TFA or session token       |

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

### API Client Pattern (Tests)

**IMPORTANT**: API client methods must accept typespec request objects, not individual parameters.

```typescript
// Import types from typespec
import {
	AdminLoginRequest,
	AdminLoginResponse,
} from "../../specs/typespec/admin/admin-users";

export class AdminAPIClient {
	constructor(private request: APIRequestContext) {}

	// ✅ CORRECT: Accept typespec request object
	async login(request: AdminLoginRequest): Promise<APIResponse<AdminLoginResponse>> {
		const response = await this.request.post("/admin/login", {
			data: request,
		});

		const body = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: body as AdminLoginResponse,
			errors: body.errors,
		};
	}

	// For testing invalid payloads
	async loginRaw(body: unknown): Promise<APIResponse<AdminLoginResponse>> {
		const response = await this.request.post("/admin/login", {
			data: body,
		});
		const responseBody = await response.json().catch(() => ({}));
		return {
			status: response.status(),
			body: responseBody as AdminLoginResponse,
			errors: responseBody.errors,
		};
	}
}
```

**Usage in tests:**
```typescript
// Import types from typespec
import type { AdminLoginRequest } from "../../../specs/typespec/admin/admin-users";

// ✅ CORRECT: Create typed request object
const loginRequest: AdminLoginRequest = {
	email: "admin@example.com",
	password: "Password123$",
};
const response = await api.login(loginRequest);

// ❌ WRONG: Don't pass individual parameters
// const response = await api.login(email, password);
```

### Key Test Utilities

- `generateTestEmail(prefix)`: Creates unique email like `prefix-{uuid}@test.vetchium.com`
- `createTestAdminUser(email, password, status?)`: Creates admin in global DB
- `deleteTestAdminUser(email)`: Removes admin and cascades to sessions/tokens
- `getTfaCodeFromEmail(email)`: Waits for and extracts 6-digit TFA code from mailpit
