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

## Build Commands

### TypeSpec (specs/typespec/)

```bash
bun install
tsp compile . # Generate OpenAPI specs
```

### Frontend

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
docker compose -f docker-compose-full.yaml up --build   # Start all services
docker compose -f docker-compose-full.yaml down -v      # Stop all services
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

### Regional Database Selection

- Users and organizations sign up in a specific region (IND1, USA1, or DEU1)
- Their data is stored in that region's database for data sovereignty and compliance
- All backend instances can access any regional database connection
- The region is determined at signup and stored in the global database
- Use `s.GetRegionalDB(region)` to get the appropriate regional database connection

### Keyset Pagination

**CRITICAL**: All list APIs MUST use keyset pagination. Never use OFFSET-based pagination.

## Backend Conventions

### HTTP Response Conventions

| Scenario          | Status Code | Response Body                    |
| ----------------- | ----------- | -------------------------------- |
| JSON decode error | 400         | Error message string             |
| Validation errors | 400         | JSON array: `[{field, message}]` |
| Unauthenticated   | 401         | Empty                            |
| Forbidden         | 403         | Empty                            |
| Not found         | 404         | Empty                            |
| Conflict          | 409         | Optional JSON with error message |
| Invalid state     | 422         | Empty                            |
| Server error      | 500         | Empty                            |
| Created           | 201         | JSON resource                    |
| Deleted           | 204         | Empty                            |
| Success           | 200         | JSON                             |

**Status Code Decision Tree**:

- **404**: Resource doesn't exist (unknown domain, user, job posting)
- **401**: Authentication failure (wrong credentials, expired session/TFA token, invalid token)
- **403**: Authenticated but forbidden (wrong TFA code for valid token, insufficient permissions)
- **422**: Resource exists but in wrong state (account disabled, domain inactive)

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

**Global middleware** (applied in `cmd/api-server.go`):

- **CORS**: Handles preflight requests
- **RequestID**: Injects logger with request_id into context

**Route-specific middleware** (applied per-route):

- **Auth middleware**: Validates session tokens for protected endpoints

```go
// Routes WITHOUT auth (login, public endpoints)
mux.HandleFunc("POST /admin/login", admin.Login(s))

// Routes WITH auth (protected endpoints)
mux.Handle("POST /admin/list-approved-domains",
    middleware.AdminAuth(s.Global)(http.HandlerFunc(admin.ListApprovedDomains(s))))
```

**Extract authenticated data in handlers**:

```go
adminUser := middleware.AdminUserFromContext(ctx)
if adminUser == nil {
    log.Debug("admin user not found in context")
    w.WriteHeader(http.StatusUnauthorized)
    return
}
// Use adminUser.AdminUserID, adminUser.EmailAddress, etc.
```

## API Naming Convention

API uses **snake_case** for all JSON fields:

- Request/response fields: `tfa_token`, `domain_name`, `created_at`
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
Use Authorization Header for passing session tokens. Do not pass session tokens in request bodies.

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

**Source of Truth**: `.tsp` files define the API contract. The `.ts` and `.go` files must be kept in sync.

**Workflow**:

1. Define types in `.tsp` files (TypeSpec format)
2. Implement matching `.ts` types with validation functions
3. Implement matching `.go` types with validation methods
4. Run `tsp compile .` to generate OpenAPI specs
5. Verify all three files (.tsp, .ts, .go) are consistent

The `.tsp` compilation generates OpenAPI specs for documentation, but does NOT generate Go or TypeScript code. Developers must maintain consistency across all three files manually.

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
const hubLoginRequest: HubLoginRequest = {
	email_address: email,
	password: password,
};

const response = await api.login(hubLoginRequest);

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

### Component Guidelines

- **Pages**: Handle routing, data fetching, layout. Import forms and components.
- **Forms**: Handle form state, validation, submission. Use Ant Design Form.
- **Components**: Stateless/minimal state, reusable across pages/forms.

### Auth Flow and Error Handling

**Auth state machine**: `"login"` → `"tfa"` → `"authenticated"`

1. User submits credentials → API returns TFA token
2. User submits TFA code → API returns session token
3. Session token stored in cookie for subsequent requests

**HTTP error handling pattern**:

```typescript
// Map HTTP status codes to user-friendly error messages
switch (response.status) {
	case 400:
		setError(parseValidationErrors(body)); // Field-level errors
		break;
	case 401:
		setError(t("invalidCredentials")); // Wrong password, expired token
		break;
	case 403:
		setError(t("invalidCode")); // Wrong TFA code
		break;
	case 422:
		setError(t("accountDisabled")); // Account in wrong state
		break;
	default:
		setError(t("serverError"));
}
```

**Session storage**: Session token stored in cookie `vetchium_{app}_session` with 24h expiry, SameSite=Strict, HttpOnly.

### API Client Pattern (Frontend)

Use native `fetch()` with explicit status code handling:

```typescript
var loginRequest: LoginRequest;
const response = await fetch(`${API_BASE}/admin/login`, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify(loginRequest),
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

## Security Best Practices

### Input Validation

- Always validate request bodies using TypeSpec validators before processing
- TypeSpec validators handle length limits, format validation, and pattern matching
- Database layer uses parameterized queries via sqlc (no raw SQL in handlers)

### What NOT to Log

Never log sensitive data:

- Passwords (plaintext or hashed)
- Session tokens or TFA tokens
- TFA codes
- Full email addresses in error messages (use hashes or IDs instead)
- Credit card numbers, personal identification numbers

### Safe Logging Examples

```go
// ✅ GOOD: Log IDs and hashes
log.Info("user login successful", "admin_user_id", adminUser.AdminUserID)
log.Debug("session created", "session_token_hash", hashPrefix(token))

// ❌ BAD: Don't log sensitive data
log.Info("user logged in", "password", password)  // Never!
log.Debug("tfa code", "code", tfaCode)  // Never!
```

### Database Security

- All queries use sqlc parameterization (prevents SQL injection)
- No raw SQL string concatenation allowed

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

**Prerequisites**: All Docker services must be running via `docker compose up -f docker-compose-full.yaml` from `src/`.

### Test Architecture Principles

1. **Full Parallelization**: All tests run in parallel. Each test must be completely independent.

2. **Isolated Test Data**: Each test creates its own unique test data using UUID-based identifiers (e.g., `admin-{uuid}@test.vetchium.com`).

3. **No Test Data in Migrations**: Test users are created dynamically via the `lib/db.ts` helper, not in migration files. Migration files are used for production.

4. **Cleanup in Finally Blocks**: Always clean up test data in `finally` blocks or `afterEach` hooks to ensure cleanup even on test failures.

5. **Region Awareness**: The API runs behind a load balancer (`localhost:8080`) that routes to regional servers. Tests don't need to specify regions explicitly.

### Required Test Scenarios

Every API endpoint test MUST cover these scenarios:

| Scenario                | Expected Status | Example                                |
| ----------------------- | --------------- | -------------------------------------- |
| Success case            | 200/201/204     | Valid request with valid auth          |
| Missing required fields | 400             | `{ password: "..." }` (no email)       |
| Invalid field format    | 400             | Invalid email format, wrong length     |
| Empty string fields     | 400             | `{ email: "", password: "..." }`       |
| Boundary conditions     | 400             | Min/max length violations              |
| Non-existent resource   | 404             | Unknown domain, unknown job posting    |
| Auth: Unknown user      | 401             | Login with non-existent email          |
| Auth: Invalid token     | 401             | Expired/invalid session or TFA token   |
| Wrong credentials       | 401             | Correct email, wrong password          |
| Wrong TFA code          | 403             | Valid TFA token, wrong code            |
| Disabled/invalid state  | 422             | Disabled user account, inactive domain |
| Expired tokens          | 401             | Expired TFA or session token           |

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
		var adminLoginRequest: AdminLoginRequest;
		const response = await api.login(adminLoginRequest);
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
	async login(
		request: AdminLoginRequest
	): Promise<APIResponse<AdminLoginResponse>> {
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
