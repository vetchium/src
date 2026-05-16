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
   - Before writing any fetch/API call in a `.tsx` file, read the relevant `.ts` file in `specs/typespec/` to confirm the exact type names and field names — do NOT guess or reconstruct them from memory
   - Before writing handler code in a `.go` file, read the relevant `.go` file in `specs/typespec/` to confirm the exact type names and field names
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
docker compose -f docker-compose-ci.json up --build -d
docker compose -f docker-compose-ci.json down -v
```

## Object Storage (LocalStack / S3-compatible)

Three separate LocalStack instances in dev/CI — one per region. Each regional API server holds N S3 clients (one per region) in `AllStorageConfigs`, selected by the owning entity's home region (ADR-001 §1.4). Global assets (tag icons) use a separate global S3 config.

Per-region env vars on regional API servers:

| Variable pattern                | Example value (ind1)          |
| ------------------------------- | ----------------------------- |
| `S3_ENDPOINT_{REGION}`          | `http://localstack-ind1:4566` |
| `S3_BUCKET_{REGION}`            | `vetchium-ind1`               |
| `S3_REGION_{REGION}`            | `us-east-1`                   |
| `S3_ACCESS_KEY_ID_{REGION}`     | `vetchium-dev-key`            |
| `S3_SECRET_ACCESS_KEY_{REGION}` | `vetchium-dev-secret`         |

Global S3 env vars (regional servers + global-service):

| Variable                      | Value (dev)                   |
| ----------------------------- | ----------------------------- |
| `GLOBAL_S3_ENDPOINT`          | `http://localstack-ind1:4566` |
| `GLOBAL_S3_BUCKET`            | `vetchium-global`             |
| `GLOBAL_S3_REGION`            | `us-east-1`                   |
| `GLOBAL_S3_ACCESS_KEY_ID`     | `vetchium-dev-key`            |
| `GLOBAL_S3_SECRET_ACCESS_KEY` | `vetchium-dev-secret`         |

When adding a storage feature: use AWS SDK v2 with `UsePathStyle: true` (required by LocalStack). Use `s.GetStorageConfig(region)` for per-entity blobs and `s.GetGlobalStorageConfig()` for global assets. Host S3 debug endpoints: `http://localhost:4566` (ind1), `http://localhost:4567` (usa1), `http://localhost:4568` (deu1).

## Database Architecture

- **Global DB**: Cross-region lookups, user identity, email hashes (thin routing table)
- **Regional DBs** (ind1:5433, usa1:5434, deu1:5435): All PII, credentials, mutable data

See [ADD_NEW_REGION.md](./ADD_NEW_REGION.md) for the region registry architecture and runbook for adding a new region.

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

## Database Performance & Efficiency

**CRITICAL**: Within a single handler, you MUST NOT perform more than one round-trip to the **same** logical database (Global or Regional).

- **Cross-DB Data**: If data lives in both Global and Regional DBs, make **exactly one call to each**. Do NOT denormalize global data into regions just to save a single round-trip.
- **Avoid N+1 Problem**: Never perform database calls inside a loop.
- **Bulk Operations**: If you have a list of items from one DB and need data from another, use **one bulk lookup** (e.g., `WHERE id IN (...)` or `ANY($1)`) instead of individual calls.
- **One Round-Trip**: Use complex SQL (JOINs, CTEs, correlated subqueries) to fetch or update all required data for that database in a single round-trip. Use `RETURNING *` for atomic read-after-write.

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
func MyHandler(s *server.RegionalServer) http.HandlerFunc {
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

### Audit Logging

**CRITICAL**: Every write handler MUST record an audit log entry. The audit log write MUST be included inside the same `WithGlobalTx` / `WithRegionalTx` transaction as the primary write — if the audit write fails the whole operation rolls back. There is no best-effort or fire-and-forget approach.

The only exception is `login_failed` events (no wrapping transaction exists since no DB write succeeds) — these are written as standalone single-row inserts.

- Admin portal events → `admin_audit_logs` table in Global DB
- Org / Hub portal events → `audit_logs` table in Regional DB
- `event_type` follows the `portal.action_name` convention (e.g. `admin.invite_user`, `org.add_cost_center`)
- Never store raw email addresses in `event_data`; use SHA-256 hash only
- Extract the client IP from `X-Forwarded-For` (first entry), falling back to `r.RemoteAddr`

### Logging Conventions

```go
log := s.Logger(ctx)
log.Debug("validation failed", "errors", errs)  // expected/handled errors
log.Error("failed to query DB", "error", err)   // actual errors
log.Info("user created", "id", userID)          // successes
```

Never log passwords, session tokens, TFA codes, or full email addresses.

### Handler Organization & Middleware

Handlers in `api-server/handlers/{admin,hub,org}/`. All deps via `*server.RegionalServer` (for regional portals) or `*server.GlobalServer` (for admin).

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

- Use POST for all CRUD and state-changing operations; pass all params in request body
- Use GET only for parameterless reads (`GET /org/myinfo`, `GET /public/tag-icon`)
- No DELETE routes — use `POST /org/delete-{resource}` for permanent removal
- Pass session tokens in `Authorization: Bearer <token>` header, not body

### API Path Structure

One universal pattern:

```
POST /{portal}/{verb}-{resource}
POST /{portal}/{namespace}/{verb}-{resource}   ← namespace only when grouping is needed
```

Examples:

```
POST /org/create-opening
POST /org/list-openings
POST /org/marketplace/create-listing
POST /org/marketplace/list-subscriptions
POST /admin/marketplace/create-capability
```

Auth/session ops stay flat with no resource: `login`, `logout`, `tfa`, `myinfo`, `change-password`, `set-language`, `complete-signup`, `request-password-reset`, etc.

### Action Verbs

| Intent                 | Verb        | Example                                                                                                                                                           |
| ---------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create new resource    | `create-*`  | `create-opening`, `create-address`                                                                                                                                |
| Read single resource   | `get-*`     | `get-opening`, `get-cost-center`                                                                                                                                  |
| Paginated list         | `list-*`    | `list-openings`, `list-users`, `list-audit-logs`                                                                                                                  |
| Update resource fields | `update-*`  | `update-opening`                                                                                                                                                  |
| Permanently remove     | `delete-*`  | `delete-domain`                                                                                                                                                   |
| Toggle off             | `disable-*` | `disable-address`, `disable-suborg`                                                                                                                               |
| Toggle on              | `enable-*`  | `enable-address`, `enable-suborg`                                                                                                                                 |
| Add to a collection    | `add-*`     | `add-suborg-member`, `add-cost-center`                                                                                                                            |
| Remove from collection | `remove-*`  | `remove-suborg-member`                                                                                                                                            |
| Semantic lifecycle     | `{verb}-*`  | `submit-opening`, `approve-opening`, `reject-opening`, `pause-opening`, `reopen-opening`, `archive-opening`, `duplicate-opening`, `claim-domain`, `verify-domain` |

**`add-*` vs `create-*`**: `add-*` for items that belong to an existing parent collection (suborg members, cost centers, tags, approved domains). `create-*` for standalone entities (suborgs, openings, addresses).

**`list-*` for all paginated endpoints** — no `filter-*` verb.

### Request Body Conventions

**Identifying a resource:**

- Use `{resource}_id: string` for UUID-keyed resources — e.g. `opening_id`, `address_id`, `cost_center_id`
- Never use bare `id` — always prefix with the resource name
- Use the natural key when no UUID exists — e.g. `domain_name`, `email_address`
- Composite-key resources (marketplace listings) use their public key fields: `org_domain` + `listing_number`

**All paginated list request bodies must include:**

```typescript
pagination_key?: string;   // keyset cursor
limit?: int32;             // page size; default and max enforced server-side
filter_{field}?: type;     // zero or more optional filter fields
```

**All paginated list response bodies must include:**

```typescript
{resources}: ResourceType[];   // plural snake_case of the resource name — never `items`
next_pagination_key?: string;
```

## TypeSpec Validation

`.tsp` files are the source of truth. Keep `.ts` and `.go` files in sync manually (tsp compile only generates OpenAPI specs).

**CRITICAL**: Import all API types from `specs/typespec/`. Never define API schemas locally — in any file (`.tsx`, `.ts`, `.go`, or Playwright test files).

### TypeScript / Frontend (`.tsx`, `.ts`, Playwright)

Always import request and response types from the spec package before writing any fetch call or type annotation:

```typescript
// ✅ CORRECT — import before using
import type { CreateOpeningRequest, Opening, ListOpeningsResponse } from "vetchium-specs/org/openings";
const req: CreateOpeningRequest = { title, description, ... };
const data = await response.json() as Opening;
```

```typescript
// ❌ WRONG — inline type definitions are forbidden
const req = { title, description, ... };                          // untyped — no compile-time safety
type Opening = { title: string; status: string; ... };            // local definition duplicates the spec
const data = await response.json() as { title: string; ... };     // inline cast hides spec drift
```

Rules:

- **Read `specs/typespec/{portal}/{resource}.ts` before writing any fetch call** — confirm exact field names and types; never reconstruct from memory or copy from another component
- All `fetch()` request bodies must be typed with the spec's request type
- All `response.json()` casts must use the spec's response type
- All list responses must use the spec's list response type (e.g. `ListOpeningsResponse`) — not an ad-hoc `{ openings: Opening[] }`
- Never use `any` for API payloads — always use the imported type

### Go / Backend

Always import request and response types from the spec package:

```go
// ✅ CORRECT
import org "vetchium-api-server.typespec/org"

var req org.CreateOpeningRequest
if err := json.NewDecoder(r.Body).Decode(&req); err != nil { ... }
if errs := req.Validate(); len(errs) > 0 { ... }
```

```go
// ❌ WRONG — local struct duplicates the spec and drifts silently
type createOpeningRequest struct { Title string `json:"title"`; ... }
```

Rules:

- **Read `specs/typespec/{portal}/{resource}.go` before writing the handler** — confirm exact type and field names
- Use the spec type directly for `json.Decode` and call `.Validate()` on it
- Never copy-paste fields into a local struct

TypeScript validators: `validate{TypeName}(request): ValidationError[]`. Field validators return `string | null`.

Go: types from `vetchium-api-server.typespec/{package}` with `.Validate()` method returning `[]ValidationError`.

### Enum Types: No String Literals

**CRITICAL**: TypeSpec enums compile to TypeScript union types (e.g. `type MarketplaceEnrollmentStatus = "pending_review" | "approved" | ...`). These have no runtime value — there is no `MarketplaceEnrollmentStatus.pending_review` constant. But they MUST still be used to get compile-time safety.

Rules:

1. **In `.tsp` files**: use enum types for all status/mode fields — never `string`. Cross-namespace enums require an explicit import (`import "../org/marketplace.tsp"`).
2. **In `.ts` files**: model fields and `filter_status` request fields must use the enum type, not `string`. Cross-package enums must be imported explicitly.
3. **In `.go` files**: same — use the typed enum, not `string`. Import the package and cast with `org.MarketplaceEnrollmentStatus(dbRow.Status)`.
4. **In frontend UI**: annotate status arrays and comparisons with the enum type so TypeScript catches wrong literals:

```typescript
// ✅ CORRECT — TypeScript flags "pending_approval" as a type error
import type { MarketplaceEnrollmentStatus } from "vetchium-specs/org/marketplace";
const filterOptions: MarketplaceEnrollmentStatus[] = [
    "pending_review", "active", "rejected", "suspended", "expired",
];
if (record.status === "pending_review") { ... }  // record.status: MarketplaceEnrollmentStatus

// ❌ WRONG — untyped; any typo silently passes
const filterOptions = ["pending_approval", ...];   // "pending_approval" doesn't exist
if (record.status === "pending_approval") { ... }  // status: string — no error raised
```

The pattern that caused the `"pending_approval"` bug: admin TypeSpec used `status: string` instead of the proper enum type, so TypeScript had no basis to reject the wrong literal. Always use the narrowest possible type.

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

### Page Layout Standard

All **feature pages** (list/table pages reached from the dashboard) use this layout:

```tsx
<div style={{ width: "100%", maxWidth: 1200, padding: "24px 16px", alignSelf: "flex-start" }}>
  {/* Back button — always the first element */}
  <div style={{ marginBottom: 16 }}>
    <Link to="/"><Button icon={<ArrowLeftOutlined />}>{t("backToDashboard")}</Button></Link>
  </div>

  {/* Page header: title only */}
  <Title level={2} style={{ marginBottom: 24 }}>{t("title")}</Title>

  {/* Page header: title + primary action button */}
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
    <Title level={2} style={{ margin: 0 }}>{t("title")}</Title>
    <Button type="primary" icon={<PlusOutlined />} onClick={...}>{t("addButton")}</Button>
  </div>

  {/* page content — no outer Card wrapper */}
</div>
```

Rules:

- `maxWidth: 1200` for all portals
- i18n key for back button: `backToDashboard` in the page's own namespace
- Title always `level={2}`; no colored icons in the title
- No outer Card wrapper (Cards are fine inside the page for sub-sections)
- **Form pages** (login, change-password, etc.) are exempt — they use centered Cards

### UI Route Structure

**All new feature routes MUST follow this pattern:**

| Page           | Route pattern                  | Example                                 |
| -------------- | ------------------------------ | --------------------------------------- |
| List           | `/{resource}`                  | `/openings`, `/cost-centers`            |
| Create         | `/{resource}/new`              | `/openings/new`                         |
| Detail         | `/{resource}/:resourceId`      | `/openings/:openingId`                  |
| Edit           | `/{resource}/:resourceId/edit` | `/openings/:openingId/edit`             |
| Settings-scope | `/settings/{resource}`         | `/settings/plan`, `/settings/addresses` |

Rules:

- Always plural kebab-case for the resource segment: `/cost-centers` not `/cost-center` or `/costCenters`
- Never use `-management` suffix or `manage-` prefix for list pages — those are legacy violations documented in `specs/api-ui-inconsistencies.md`
- Settings-scoped config (plan, addresses) lives under `/settings/`; core admin features (users, domains) live at top level

### i18n

Use `react-i18next`. Supported: en-US (default), de-DE, ta-IN. All user-visible strings must be translated. Language preference stored server-side when authenticated, cached locally.

### Date and Time Formatting

**CRITICAL**: Never call `.toLocaleString()`, `.toLocaleDateString()`, or `.toLocaleTimeString()` directly. Always use the shared utilities and pass the active i18n locale so the format matches the user's app language:

```typescript
import { formatDateTime, formatDate } from "../../utils/dateFormat";
// in the component:
const { t, i18n } = useTranslation("namespace");
// in JSX / table render:
formatDateTime(record.created_at, i18n.language); // date + time (timestamps, audit logs)
formatDate(record.updated_at, i18n.language); // date only (subscription dates, etc.)
```

Rules:

- Use `formatDateTime` for timestamps where the time matters (created_at, assigned_at, event times)
- Use `formatDate` for date-only fields (updated_at on subscriptions, started_at subscription dates)
- Both functions use `month: "short"` to avoid MM/DD vs DD/MM ambiguity regardless of locale
- The utilities live at `{ui}/src/utils/dateFormat.ts` and are identical across all three UIs

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

- `admin:superadmin` / `org:superadmin` — bypass all role checks
- `hub:read_posts` (auto-assigned at signup), `hub:write_posts`, `hub:apply_jobs`
- Pattern: `view_*` = read-only, `manage_*` = all writes

### Superadmin and Approval Flows

For any intra-org approval flow (e.g. Draft → Pending Review → Published), if the actor is `org:superadmin` the approval step is skipped and the resource goes directly to the final approved state. This accommodates single-person companies where the same user would otherwise have to approve their own submissions.

Example (from marketplace listings and job openings):

- Non-superadmin submits → `pending_review`
- `org:superadmin` submits → `published` / `active` directly

Always add a test scenario for this shortcut path alongside the normal submit test.

### Where Roles Are Stored

- Admin → Global DB (`admin_user_roles`)
- Org/Hub → Regional DB (`org_user_roles`, `hub_user_roles`)

### Checklist: Adding a New Feature

1. **Define roles** (if new): add to initial_schema.sql + `specs/typespec/common/roles.ts` AND `specs/typespec/common/roles.go` (both must be kept in sync)
2. **Protect backend route**:
   ```go
   // same pattern for all portals
   adminRole := middleware.AdminRole(s.Global, "admin:new_feature")
   mux.Handle("POST /admin/new-thing", adminAuth(adminRole(admin.NewThing(s))))
   ```
3. **Make UI tile role-aware**: derive access flags from `myInfo.roles`, conditionally render
4. **Hide write actions** for read-only roles within feature pages (UI is defence-in-depth; backend MUST enforce independently → 403)
5. **Add audit log writes** for every write handler (see Audit Logging section above)
6. **Add RBAC tests** directly in the endpoint's feature spec file (see RBAC Test Policy below)

### RBAC Test Policy

**CRITICAL**: Every role-protected endpoint MUST have these two tests co-located in its own feature spec file:

1. **Positive test**: a non-superadmin user WITH the required role calls the endpoint → 200/201/204
2. **Negative test**: an authenticated user with NO roles calls the endpoint → 403

Rules:

- Add RBAC tests directly in the endpoint's feature spec file (e.g., `claim-domain.spec.ts`, `invite-user.spec.ts`) alongside the functional and 401 tests — add a dedicated `describe` block for RBAC within the file
- Use `assignRoleToAdminUser` / `assignRoleToOrgUser` DB helpers to grant roles directly (bypassing API validation) for test setup
- Use `createTestAdminUser` / `createTestOrgUserDirect` for no-role users
- `describe` blocks that share state via `beforeAll` must use `test.describe.configure({ mode: "serial" })` when tests have ordering dependencies (e.g., disable before enable)
- Cleanup: always delete created resources in `afterAll`/`finally`; use fresh `generateTestDomainName()` domains when testing claim-domain (not the org's own domain which is already in `global_employer_domains`)

**Why superadmin tests are not sufficient**: superadmin bypasses all role checks, so a passing superadmin test does NOT prove the role grant works. You need a non-superadmin with the specific role.

| Portal | Middleware                            | Superadmin role    | Roles DB |
| ------ | ------------------------------------- | ------------------ | -------- |
| Admin  | `middleware.AdminRole(s.Global, ...)` | `admin:superadmin` | Global   |
| Org    | `middleware.OrgRole(s.Regional, ...)` | `org:superadmin`   | Regional |
| Hub    | `middleware.HubRole(s.Regional, ...)` | (none)             | Regional |

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

### Test Isolation: Unique Domains and Emails

**CRITICAL**: Every test that creates an org or org user MUST use globally-unique identifiers so parallel test runs never conflict:

- **Org domains**: always use `generateTestOrgEmail(prefix)` or `generateTestDomainName(prefix)` — these embed a UUID substring, e.g. `rbac-spd-adm-a1b2c3d4.test.vetchium.com`. Never hard-code or reuse a domain across tests.
- **User emails**: always derived from the org domain (`user@{generatedDomain}`) so they are equally unique.
- **RBAC tests with shared orgs**: when multiple users must belong to the same org (e.g. an admin who creates a resource + a viewer who reads it), create the admin first, capture its `orgId`, then pass `{ orgId: adminResult.orgId, domain: adminDomain }` to `createTestOrgUserDirect` for additional users. **Never** create the additional user in a separate org and expect them to share resources.
- **Cleanup**: delete every created resource/user in `afterAll`/`finally`; also call `deleteTestGlobalOrgDomain` for any extra domains claimed during the test.

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

### Audit Log Tests

Every write API test MUST include an audit log assertion after the success case. After calling the write endpoint, query the appropriate list-audit-logs API and assert:

- An entry exists with the correct `event_type`
- `actor_user_id` matches the authenticated user (or is null for unauthenticated events)
- `target_user_id` is correct where applicable
- `event_data` contains the expected fields (no raw emails — hashes only)
- No audit log entry is created when the request fails (4xx) — assert the count is unchanged

For `login_failed` events, assert the entry is written even though the login returned 401.

### Writing Tests

See `playwright/tests/api/admin/login.spec.ts` for the full pattern. Key helpers:

- `generateTestEmail(prefix)` → unique email
- `createTestAdminUser(email, password)` / `deleteTestAdminUser(email)` → use in try/finally
- `getTfaCodeFromEmail(email)` → extracts code from mailpit

API client methods accept typespec request objects (not individual params). See `playwright/lib/api-client.ts`. Provide both typed and `*Raw()` methods for invalid-payload testing.
