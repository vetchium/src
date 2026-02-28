# CLAUDE.md

Guidance for Claude Code when working with the Vetchium codebase.

## Project Overview

Vetchium is a multi-region job search and hiring platform. User types: Professionals/HubUsers, Employers/OrgUsers, Agencies/AgencyUsers. Regional data isolation with global coordination.

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

- LF line endings, UTF-8 encoding, trim trailing whitespace

### Avoiding Deprecated APIs

**CRITICAL**: Do NOT use deprecated functions from any library.

- IDE warnings + ESLint (`@typescript-eslint/no-deprecated` in hub-ui, admin-ui) will flag them
- Check library docs/changelog before implementing; run `bun run lint` before commits
- Common Ant Design v6 deprecations:
  - Alert: `closable={{ onClose/afterClose/closeIcon: ... }}` (not separate props); `title` not `message`
  - Select: `showSearch={{ filterOption: ... }}` (not separate `filterOption`)

### Development Process

1. Write spec under `specs/` using the template at `specs/spec-template-README.md`
2. Add/update `.tsp` files under `specs/typespec/` — confirm API endpoints with Human before proceeding
3. Implement matching `.ts` and `.go` type/validation files from the `.tsp`
4. Implement backend + frontend — plan all file changes first
   - **CRITICAL**: All API request/response types MUST be imported from `specs/typespec/`; never define locally
5. All DB SQL goes in `api-server/db/` `.sql` files via sqlc — no SQL in `.go` files
6. Write Playwright tests under `playwright/` — import all types from `specs/typespec/`
7. Format: `goimports -w` for Go; `prettier --write` for md/ts/tsx/js/json/yaml
8. New config values → environment variables; update docker-compose files accordingly

## Build Commands

```bash
# TypeSpec
cd specs/typespec && bun install && tsp compile .

# Frontend (hub-ui, admin-ui, etc.)
bun install && bun run dev|build|lint

# Backend (from api-server/)
sqlc generate
go build -o global-service       ./cmd/global-service/
go build -o regional-api-server  ./cmd/regional-api-server/
go build -o regional-worker      ./cmd/regional-worker/

# Docker (from src/)
docker compose -f docker-compose-full.json up --build
docker compose -f docker-compose-full.json down -v
```

## Object Storage (LocalStack / S3-compatible)

One LocalStack instance for all regions in dev/CI. Env vars (set in docker-compose):

| Variable               | Value (dev)              |
| ---------------------- | ------------------------ |
| `S3_ENDPOINT`          | `http://localstack:4566` |
| `S3_ACCESS_KEY_ID`     | `vetchium-dev-key`       |
| `S3_SECRET_ACCESS_KEY` | `vetchium-dev-secret`    |
| `S3_REGION`            | `us-east-1`              |
| `S3_BUCKET`            | `vetchium`               |

When adding a storage feature: use AWS SDK v2 with `UsePathStyle: true` (required by LocalStack). Access via `s.StorageConfig`. Host S3 endpoint for debugging: `http://localhost:4566`.

## Database Architecture

- **Global DB**: Cross-region lookups, user identity, email hashes (thin routing table)
- **Regional DBs** (ind1:5433, usa1:5434, deu1:5435): All PII, credentials, mutable data

**Migrations**: Edit existing `api-server/db/migrations/{global,regional}/00000000000001_initial_schema.sql` directly (no new migration files until production). No new indexes for performance; use `UNIQUE` in CREATE statements instead.

### Database Write Operations & Transactions

**CRITICAL**: All writes touching >1 row/table MUST use transactions. Use `s.WithGlobalTx` / `s.WithRegionalTx`:

```go
err = s.WithGlobalTx(ctx, func(qtx *globaldb.Queries) error {
    if err := qtx.CreateFoo(ctx, fooParams); err != nil { return err }
    return qtx.UpdateBar(ctx, barParams)
})
if err != nil {
    if errors.Is(err, server.ErrConflict) { w.WriteHeader(http.StatusConflict); return }
    log.Error("failed", "error", err); http.Error(w, "", http.StatusInternalServerError); return
}
```

Custom error types: `server.ErrNotFound` → 404, `server.ErrConflict` → 409, `server.ErrInvalidState` → 422.

**Cross-database** (global + regional): global first, then regional, with compensating transaction on failure. Log `CONSISTENCY_ALERT` when compensation itself fails.

### Regional Database Selection

Region determined at signup, stored in global DB. Use `s.GetRegionalDB(region)` to get regional connection.

### Keyset Pagination

**CRITICAL**: All list APIs MUST use keyset pagination. Never use OFFSET.

## Backend Conventions

### HTTP Response Conventions

| Scenario          | Status | Body                             |
| ----------------- | ------ | -------------------------------- |
| JSON decode error | 400    | Error message string             |
| Validation errors | 400    | JSON array: `[{field, message}]` |
| Unauthenticated   | 401    | Empty                            |
| Forbidden         | 403    | Empty                            |
| Not found         | 404    | Empty                            |
| Conflict          | 409    | Optional JSON                    |
| Invalid state     | 422    | Empty                            |
| Server error      | 500    | Empty                            |
| Created           | 201    | JSON resource                    |
| Deleted           | 204    | Empty                            |
| Success           | 200    | JSON                             |

**Status code decision tree**: 404=resource doesn't exist; 401=auth failure (bad creds/expired token); 403=authenticated but forbidden; 422=resource exists but wrong state (disabled account).

### Handler Implementation Pattern

Handlers follow: decode → validate → query/write (in tx) → check state → respond.

```go
func MyHandler(s *server.Server) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "application/json")
        ctx := r.Context()
        log := s.Logger(ctx)

        var req types.MyRequest
        if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
            log.Debug("failed to decode", "error", err)
            http.Error(w, err.Error(), http.StatusBadRequest); return
        }
        if errs := req.Validate(); len(errs) > 0 {
            w.WriteHeader(http.StatusBadRequest); json.NewEncoder(w).Encode(errs); return
        }
        // reads: s.Global/s.Regional directly; writes: WithGlobalTx/WithRegionalTx
        json.NewEncoder(w).Encode(result)
    }
}
```

See existing handlers in `api-server/handlers/` for full examples.

### Logging Conventions

```go
log := s.Logger(ctx)
log.Debug("validation failed", "errors", errs)  // expected/handled errors
log.Error("failed to query DB", "error", err)   // actual errors
log.Info("user created", "id", userID)          // successes
```

Never log passwords, session tokens, TFA codes, or full email addresses.

### Handler Organization & Middleware

Handlers in `api-server/handlers/{admin,hub,org,agency}/`. All deps via `*server.Server`.

```go
// Without auth
mux.HandleFunc("POST /admin/login", admin.Login(s))
// With auth + role
mux.Handle("POST /admin/list-approved-domains",
    middleware.AdminAuth(s.Global)(middleware.AdminRole(s.Global, "admin:manage_domains")(http.HandlerFunc(admin.ListApprovedDomains(s)))))
```

Extract authenticated user: `adminUser := middleware.AdminUserFromContext(ctx)` (returns nil → 401).

## API Naming Convention

All JSON fields use **snake_case**: `tfa_token`, `domain_name`, `created_at`. Go: `json:"tfa_token"`. TypeScript: `tfa_token: string`.

## API Endpoints Convention

- Use POST for most operations; pass all params in request body
- Use DELETE only for actual deletions (prefer disabling over deleting)
- Pass session tokens in `Authorization: Bearer <token>` header, not body
- Use distinct endpoint names to avoid accidental handler conflicts:
  - ✅ `/admin/add-approved-domain`, `/admin/list-approved-domains`
  - ❌ `/admin/approved-domains` (GET vs POST collision risk)

## TypeSpec Validation

`.tsp` files are the source of truth. Keep `.ts` and `.go` files in sync manually (tsp compile only generates OpenAPI specs).

**CRITICAL**: Import all API types from `specs/typespec/`. Never define API schemas locally.

```typescript
// ✅ CORRECT
import type { HubLoginRequest } from "vetchium-specs/hub/hub-users";
const req: HubLoginRequest = { email_address: email, password };
```

TypeScript validators: `validate{TypeName}(request): ValidationError[]`. Field validators return `string | null`.

Go: types from `vetchium-api-server.typespec/{package}` with `.Validate()` method returning `[]ValidationError`.

## Frontend Architecture

```
src/
├── components/   # Reusable UI components
├── pages/        # Page components (routing, data fetching)
├── forms/        # Form components (state, validation, submission)
├── contexts/     # React contexts
├── hooks/        # Custom hooks
├── locales/      # en-US/, de-DE/, ta-IN/ translation files
├── config.ts
└── App.tsx
```

### i18n

Use `react-i18next`. Supported: en-US (default), de-DE, ta-IN. All user-visible strings must be translated. Language preference stored server-side when authenticated, cached locally.

### Forms

- Disable submit when form has errors (use `Form.Item shouldUpdate` + `form.getFieldsError()`)
- Wrap with `<Spin spinning={loading}>` during network calls to prevent double-submission

### Auth Flow

State machine: `"login"` → `"tfa"` → `"authenticated"`. Map status codes to i18n strings: 400→validation errors, 401→invalidCredentials, 403→invalidCode, 422→accountDisabled. Session token in `vetchium_{app}_session` cookie (24h, HttpOnly, SameSite=Strict).

Use native `fetch()` with explicit per-status handling (don't use `response.ok`).

## RBAC

Every new feature MUST complete this checklist.

### Role Naming: `portal:action`

Current roles — see `specs/typespec/common/roles.ts` and `MEMORY.md` for the full list. Key roles:

- `admin:superadmin` / `employer:superadmin` / `agency:superadmin` — bypass all role checks
- `hub:read_posts` (auto-assigned at signup), `hub:write_posts`, `hub:apply_jobs`
- Pattern: `view_*` = read-only, `manage_*` = all writes

### Where Roles Are Stored

- Admin → Global DB (`admin_user_roles`)
- Employer/Agency/Hub → Regional DB (`org_user_roles`, `agency_user_roles`, `hub_user_roles`)

### Checklist: Adding a New Feature

1. **Define roles** (if new): add to initial_schema.sql + `specs/typespec/common/roles.ts`
2. **Protect backend route**:
   ```go
   // same pattern for all portals
   adminRole := middleware.AdminRole(s.Global, "admin:new_feature")
   mux.Handle("POST /admin/new-thing", adminAuth(adminRole(admin.NewThing(s))))
   ```
3. **Make UI tile role-aware**: derive access flags from `myInfo.roles`, conditionally render
4. **Hide write actions** for read-only roles within feature pages (UI is defence-in-depth; backend MUST enforce independently → 403)

| Portal   | Middleware                                 | Superadmin role       | Roles DB |
| -------- | ------------------------------------------ | --------------------- | -------- |
| Admin    | `middleware.AdminRole(s.Global, ...)`      | `admin:superadmin`    | Global   |
| Employer | `middleware.EmployerRole(s.Regional, ...)` | `employer:superadmin` | Regional |
| Agency   | `middleware.AgencyRole(s.Regional, ...)`   | `agency:superadmin`   | Regional |
| Hub      | `middleware.HubRole(s.Regional, ...)`      | (none)                | Regional |

## Security Best Practices

- Validate all request bodies via TypeSpec validators before processing
- All DB queries via sqlc (parameterized — no raw SQL concatenation)
- Never log: passwords, session/TFA tokens, TFA codes, full email addresses

## Testing

```bash
cd playwright && npm install
npm test              # all tests
npm run test:api      # API tests only
npm run test:api:admin
```

**Prerequisites**: `docker compose -f docker-compose-ci.json up --build -d` from `src/`.

### Test Architecture

- **Full parallelization**: every test is independent
- **Isolated data**: UUID-based test emails (`generateTestEmail(prefix)`)
- **No test data in migrations**: use `lib/db.ts` helpers
- **Cleanup in finally blocks**: always

### Required Test Scenarios

| Scenario               | Expected Status |
| ---------------------- | --------------- |
| Success case           | 200/201/204     |
| Missing/invalid fields | 400             |
| Non-existent resource  | 404             |
| Unknown user           | 401             |
| Invalid/expired token  | 401             |
| Wrong credentials      | 401             |
| Wrong TFA code         | 403             |
| Disabled/invalid state | 422             |

### Writing Tests

See `playwright/tests/api/admin/login.spec.ts` for the full pattern. Key helpers:

- `generateTestEmail(prefix)` → unique email
- `createTestAdminUser(email, password)` / `deleteTestAdminUser(email)` → use in try/finally
- `getTfaCodeFromEmail(email)` → extracts code from mailpit

API client methods accept typespec request objects (not individual params). See `playwright/lib/api-client.ts`. Provide both typed and `*Raw()` methods for invalid-payload testing.
