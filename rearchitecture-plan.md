# Vetchium API Server Rearchitecture Plan

## Goal

Transform the current architecture (every regional server connects to every database) into an isolated architecture where each regional server connects only to its own regional DB + global DB, with cross-region requests handled via HTTP proxying. Additionally, split each regional deployment into stateless (horizontally scalable) and stateful (singleton) components.

## Current Architecture

```
                    nginx LB (round-robin)
                    ┌──────────┐
                    │ :8080    │
                    └────┬─────┘
           ┌─────────┬──┴───┬──────────┐
           ▼         ▼      ▼          │
        ┌──────┐ ┌──────┐ ┌──────┐    │
        │IND1  │ │USA1  │ │DEU1  │    │
        │server│ │server│ │server│    │
        │      │ │      │ │      │    │
        │HTTP +│ │HTTP +│ │HTTP +│    │
        │email │ │email │ │email │    │
        │worker│ │worker│ │worker│    │
        │+clean│ │+clean│ │+clean│    │
        └─┬┬┬┬─┘ └─┬┬┬┬─┘ └─┬┬┬┬─┘   │
          ││││      ││││      ││││     │
     ┌────┘│││──────┘│││──────┘│││─────┘
     │  ┌──┘││───────┘││───────┘││
     │  │ ┌─┘│────────┘│────────┘│      ┌──────────┐
     │  │ │  └─────────┴─────────┘      │ global   │
     ▼  ▼ ▼                        ┌───▶│ api-srv  │
  IND1 USA1 DEU1               GlobalDB │ (worker  │
   DB   DB   DB  ◀──All servers────┘    │  only)   │
                    connect to all       └──────────┘
```

**Problems:**

- Every server has 4 DB connection pools (O(N^2) scaling)
- Compromising one server exposes all regions' data
- No true data sovereignty at application layer
- Adding a region requires redeploying every server
- Email worker and HTTP server are coupled in one binary

## Target Architecture

```
        Anycast DNS: api.vetchium.com
        ┌────────────┬────────────┐
        ▼            ▼            ▼
   ┌─────────┐  ┌─────────┐  ┌─────────┐
   │ IND1 LB │  │ USA1 LB │  │ DEU1 LB │
   └────┬────┘  └────┬────┘  └────┬────┘
   ┌────┴────┐  ┌────┴────┐  ┌────┴────┐
   │ IND1    │  │ USA1    │  │ DEU1    │
   │ API x N │  │ API x N │  │ API x N │  ← stateless, scales horizontally
   │(no bg   │  │(no bg   │  │(no bg   │
   │ workers)│  │ workers)│  │ workers)│
   └──┬──┬───┘  └──┬──┬───┘  └──┬──┬───┘
      │  │         │  │         │  │
      │  │ HTTP    │  │ HTTP    │  │ HTTP     Internal proxy for
      │  │◀────────┤  │◀────────┤  │◀──────   cross-region requests
      │  │         │  │         │  │
      │  ▼         │  ▼         │  ▼
      │ IND1 DB    │ USA1 DB   │ DEU1 DB
      │  ▲         │  ▲        │  ▲
      │  │         │  │        │  │
   ┌──┘  │      ┌──┘  │     ┌─┘  │
   │     │      │     │     │    │
   ▼     │      ▼     │     ▼    │
 Global  │    Global  │   Global │
   DB────┼──────DB────┼─────DB───┘        ← read for routing lookups
         │            │          │
   ┌─────┴──┐  ┌─────┴──┐  ┌───┴────┐
   │ IND1   │  │ USA1   │  │ DEU1   │
   │ Worker │  │ Worker │  │ Worker │     ← singleton per region
   │(email +│  │(email +│  │(email +│       (email worker + cleanup)
   │cleanup)│  │cleanup)│  │cleanup)│
   └────────┘  └────────┘  └────────┘

        admin-api.vetchium.com
              ┌────────┐
              │Global  │
              │Service │
              │(admin  │
              │ HTTP + │
              │cleanup │
              │+email) │
              └───┬────┘
                  ▼
              Global DB
```

### Service Definitions

| Service             | Binary                     | DB Connections                  | HTTP        | Workers                       | Scaling                  |
| ------------------- | -------------------------- | ------------------------------- | ----------- | ----------------------------- | ------------------------ |
| regional-api-server | `cmd/regional-api-server/` | Own regional + global (2 pools) | Yes (:8080) | None                          | Horizontal (N instances) |
| regional-worker     | `cmd/regional-worker/`     | Own regional only (1 pool)      | No          | Email + cleanup               | Singleton per region     |
| global-service      | `cmd/global-service/`      | Global only (1 pool)            | Yes (:8081) | Global cleanup + global email | Single instance          |

### Cross-Region Proxy

When a request lands on the wrong regional server, it is reverse-proxied to the correct region via an internal HTTP endpoint. The proxy is transparent to the client.

**How each request type is routed:**

| Route Type                     | Region Source                                    | Proxy Mechanism                                    |
| ------------------------------ | ------------------------------------------------ | -------------------------------------------------- |
| Authenticated (hub/org/agency) | `Authorization` header token prefix (`IND1-xxx`) | Auth middleware - before handler runs              |
| TFA (hub/org/agency)           | Request body `tfa_token` field prefix            | Handler-level - buffer body, extract prefix, proxy |
| Login (hub/org/agency)         | Global DB lookup (email hash or domain)          | Handler-level - decode body, query global, proxy   |
| Complete-password-reset        | Request body `reset_token` prefix                | Handler-level - buffer body, extract prefix, proxy |
| Complete-email-change          | Request body token prefix                        | Handler-level - buffer body, extract prefix, proxy |
| Complete-signup (hub)          | Request body `home_region` field                 | Handler-level - decode body, check field, proxy    |
| Init-signup (org/agency)       | Request body `home_region` field                 | Handler-level - decode body, check field, proxy    |
| Complete-signup (org/agency)   | Global DB token record `home_region`             | Handler-level - lookup token, get region, proxy    |
| Complete-setup (org/agency)    | Request body token prefix                        | Handler-level - buffer body, extract prefix, proxy |
| Request-signup (hub)           | Current region (any is fine)                     | No proxy needed                                    |
| Request-password-reset         | Global DB lookup (email hash)                    | Handler-level - discover region, proxy             |
| Global routes                  | No region needed (global DB only)                | No proxy needed                                    |
| Admin routes                   | Served by global-service                         | Not on regional servers                            |

---

## Implementation Phases

### Phase 1: Split Regional Binary into API + Worker

**Goal:** Separate stateless HTTP serving from stateful background work. No architecture change - just binary split. All tests pass unchanged.

#### 1.1 Create `cmd/regional-worker/main.go`

New entry point for the regional background worker. Connects to its own regional DB only.

```
Responsibilities:
- Email worker (polls DB, sends emails via SMTP)
- Regional cleanup jobs (expired hub/org/agency TFA tokens, sessions, password reset tokens, email verification tokens)
```

**What it needs:**

- 1 regional DB connection pool (from `REGIONAL_DB_CONN` env var)
- SMTP config (from existing SMTP env vars)
- Email worker config (from existing EMAIL*WORKER*\* env vars)
- Regional cleanup config (from existing cleanup interval env vars)
- `REGION` env var (for logging context)

**Implementation steps:**

1. Create `/api-server/cmd/regional-worker/main.go`:
   - Parse env: `REGIONAL_DB_CONN`, `REGION`, `LOG_LEVEL`, SMTP config, email worker config, regional cleanup config
   - Open 1 pgxpool (regional DB)
   - Create `regionaldb.Queries` from the pool
   - Start email worker goroutine using existing `email.Worker`
   - Start regional background jobs worker using existing `bgjobs.RegionalWorker`
   - Block on shutdown signal (SIGTERM/SIGINT), cancel context on signal

2. Modify `/api-server/cmd/regional-api-server/main.go`:
   - Remove email worker startup code (lines that create `email.NewSender`, `email.NewWorker`, and the goroutine that runs `emailWorker.Run`)
   - Remove regional background jobs startup code (lines that create `bgjobs.NewRegionalWorker` and the goroutine)
   - Remove SMTP config env var parsing
   - Remove email worker config env var parsing
   - Remove regional cleanup config env var parsing
   - The regional API server now only serves HTTP

3. Create `/api-server/Dockerfile.regional-worker`:
   - Same builder stage as `Dockerfile.regional` (Go 1.25-alpine, sqlc generate)
   - Build target: `./cmd/regional-worker`
   - No EXPOSE (no HTTP)

4. Update Docker Compose files (`docker-compose-ci.json`, `docker-compose-full.json`, `docker-compose-backend.json`):
   - Add 3 new services: `regional-worker-ind1`, `regional-worker-usa1`, `regional-worker-deu1`
   - Each connects to its own regional DB only
   - Each gets SMTP, email worker, and cleanup config env vars
   - Remove SMTP, email worker, and cleanup config env vars from regional-api-server services
   - Workers depend on their respective regional DB migration + seed

**Verification:** All existing Playwright tests pass. No behavior change.

---

### Phase 2: Create Global Service (Admin HTTP + Global Cleanup + Global Email)

**Goal:** Move admin HTTP handling to a dedicated global service. Admin UI connects directly to the global service. Regional servers no longer handle admin routes.

#### 2.1 Add Email Tables to Global Schema

Admin email sending currently uses regional DB email queues (`s.GetCurrentRegionalDB()`). The global service needs its own email queue.

1. Edit `/api-server/db/migrations/global/00000000000001_initial_schema.sql`:
   - Add `emails` table (copy structure from regional schema)
   - Add `email_delivery_attempts` table (copy structure from regional schema)
   - Add `email_template_type` enum (copy from regional, but only include admin-relevant types: `admin_tfa`, `admin_password_reset`, `admin_invitation`)

2. Add email queries to `/api-server/db/queries/global.sql`:
   - Copy these queries from `db/queries/emails.sql` (they are identical in structure):
     - `EnqueueEmail`
     - `GetEmailsToSend`
     - `RecordDeliveryAttempt`
     - `MarkEmailAsSent`
     - `MarkEmailAsFailed`
   - Adapt them to use globaldb types (the SQL is identical, but sqlc will generate globaldb types)

3. Run `sqlc generate` to regenerate `globaldb` package with new email types.

#### 2.2 Create `cmd/global-service/main.go`

New entry point that combines:

- Admin HTTP server (all `/admin/*` routes)
- Global background cleanup jobs (existing from `cmd/global-api-server/`)
- Global email worker (new - processes admin emails from global DB email queue)

**What it needs:**

- 1 global DB connection pool (from `GLOBAL_DB_CONN`)
- SMTP config
- Email worker config
- Global cleanup config
- Admin token config (TFA expiry, session expiry, invitation expiry, password reset expiry)
- UI config (admin URL for email links)
- HTTP server on port 8081
- `CORS_ALLOWED_ORIGINS` for admin UI

**Implementation steps:**

1. Create `/api-server/cmd/global-service/main.go`:
   - Parse env vars: `GLOBAL_DB_CONN`, `LOG_LEVEL`, SMTP config, email worker config, global cleanup config, admin token config, `ADMIN_UI_URL`, `CORS_ALLOWED_ORIGINS`
   - Open 1 pgxpool (global DB)
   - Create `globaldb.Queries`
   - Create a new `GlobalServer` struct (see 2.3)
   - Register admin routes on `http.ServeMux`
   - Apply CORS and RequestID middleware
   - Start global cleanup goroutine (existing `bgjobs.GlobalWorker`)
   - Start global email worker goroutine (new, uses globaldb email queries)
   - Start HTTP server on :8081
   - Block on shutdown, graceful shutdown on signal

2. Create `/api-server/Dockerfile.global-service`:
   - Same builder as other Dockerfiles
   - Build target: `./cmd/global-service`
   - EXPOSE 8081

3. Delete `/api-server/cmd/global-api-server/main.go` (replaced by global-service)
4. Delete `/api-server/Dockerfile.global` (replaced by Dockerfile.global-service)

#### 2.3 Create `GlobalServer` Struct

Create `/api-server/internal/server/global_server.go`:

```go
type GlobalServer struct {
    Global     *globaldb.Queries
    GlobalPool *pgxpool.Pool
    Log        *slog.Logger
    SMTPConfig *email.SMTPConfig
    TokenConfig *TokenConfig // Only admin-relevant fields used
    UIConfig    *UIConfig    // Only AdminURL used
    Environment string
}

func (s *GlobalServer) Logger(ctx context.Context) *slog.Logger {
    return middleware.LoggerFromContext(ctx, s.Log)
}

func (s *GlobalServer) WithGlobalTx(ctx context.Context, fn func(*globaldb.Queries) error) error {
    // Same implementation as Server.WithGlobalTx
}
```

#### 2.4 Adapt Admin Handlers to Use `GlobalServer`

All 15 admin handler files under `/api-server/handlers/admin/` need to change their receiver from `*server.Server` to `*server.GlobalServer`.

**Key changes per handler:**

| Handler                    | Current DB Access                                      | New DB Access                                                 |
| -------------------------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| login.go                   | `s.Global` (data) + `s.GetCurrentRegionalDB()` (email) | `s.Global` (data) + `s.Global` (email via global email queue) |
| tfa.go                     | `s.Global` only                                        | `s.Global` only (no change)                                   |
| logout.go                  | `s.Global` only                                        | No change                                                     |
| invite-user.go             | `s.Global` (data) + `s.GetCurrentRegionalDB()` (email) | `s.Global` (data + email)                                     |
| request-password-reset.go  | `s.Global` (data) + `s.GetCurrentRegionalDB()` (email) | `s.Global` (data + email)                                     |
| complete-password-reset.go | `s.Global` only                                        | No change                                                     |
| complete-setup.go          | `s.Global` only                                        | No change                                                     |
| All others                 | `s.Global` only                                        | No change                                                     |

For handlers that currently call `sendTFAEmail(ctx, regionalDB, ...)` or similar with `*regionaldb.Queries`, change to use `*globaldb.Queries`. The `sendTFAEmail`, `sendInvitationEmail`, `sendPasswordResetEmail` helper functions in admin handlers need to accept `*globaldb.Queries` and call `globaldb.EnqueueEmailParams` instead of `regionaldb.EnqueueEmailParams`.

The sqlc-generated `globaldb.EnqueueEmail` method will have the same SQL but different Go types. Update the helper functions accordingly.

#### 2.5 Create Admin Route Registration for Global Service

Create `/api-server/internal/routes/admin-global-routes.go`:

- New function `RegisterAdminGlobalRoutes(mux *http.ServeMux, s *server.GlobalServer)`.
- Copy route registrations from `admin-routes.go` but use `s.Global` for auth/role middleware:
  - `middleware.AdminAuth(s.Global)` - same as before
  - `middleware.AdminRole(s.Global, ...)` - same as before
- These middleware functions already accept `*globaldb.Queries`, not `*server.Server`, so they work unchanged.

#### 2.6 Remove Admin Routes from Regional Server

1. Delete `/api-server/internal/routes/admin-routes.go` (or remove the `RegisterAdminRoutes` function).
2. Remove `routes.RegisterAdminRoutes(mux, s)` call from `cmd/regional-api-server/main.go`.
3. Remove admin token config parsing from regional API server (AdminTFATokenExpiry, AdminSessionTokenExpiry, AdminInvitationTokenExpiry) if no other code uses them.

#### 2.7 Update Global Email Worker

The email worker (`internal/email/worker.go`) currently uses `*regionaldb.Queries`. For the global service, we need a worker that uses `*globaldb.Queries`.

**Approach:** Create a generic email worker interface or duplicate the worker for global DB.

Option A (recommended - interface):

Create `/api-server/internal/email/db.go`:

```go
// EmailDB abstracts the email queue database operations
// so the worker can operate on either globaldb or regionaldb.
type EmailDB interface {
    GetEmailsToSend(ctx context.Context, limit int32) ([]EmailRow, error)
    RecordDeliveryAttempt(ctx context.Context, params RecordAttemptParams) error
    MarkEmailAsSent(ctx context.Context, id pgtype.UUID) error
    MarkEmailAsFailed(ctx context.Context, id pgtype.UUID) error
}

// EmailRow is the common shape returned by GetEmailsToSend.
type EmailRow struct {
    EmailID       pgtype.UUID
    EmailTo       string
    EmailSubject  string
    EmailTextBody string
    EmailHtmlBody string
    EmailType     string
    AttemptCount  int64
    LastAttemptAt pgtype.Timestamp
}

// RecordAttemptParams is the common shape for RecordDeliveryAttempt.
type RecordAttemptParams struct {
    EmailID      pgtype.UUID
    ErrorMessage pgtype.Text
}
```

Create adapters:

```go
// RegionalEmailDB wraps regionaldb.Queries to implement EmailDB
type RegionalEmailDB struct { Q *regionaldb.Queries }

// GlobalEmailDB wraps globaldb.Queries to implement EmailDB
type GlobalEmailDB struct { Q *globaldb.Queries }
```

Update `Worker` to accept `EmailDB` interface instead of `*regionaldb.Queries`.

#### 2.8 Update Docker Compose

1. Replace `global-api-server` service with `global-service`:
   - Build from `Dockerfile.global-service`
   - Env vars: `GLOBAL_DB_CONN`, `LOG_LEVEL`, SMTP config, email worker config, global cleanup config, admin token config, `ADMIN_UI_URL`, `CORS_ALLOWED_ORIGINS`
   - Expose port 8081
   - Depends on: `migrate-global`, `seed-global`, `mailpit`

2. Update nginx config (`nginx/api-lb.conf`):
   - Add upstream for global service: `upstream global_service { server global-service:8081; }`
   - Add location block: `/admin/` routes to `global_service`
   - Keep existing upstream for regional servers (hub/org/agency/global routes)
   - This way all tests continue hitting `:8080` and nginx routes admin traffic to the global service

Updated nginx config structure:

```nginx
upstream regional_servers {
    server regional-api-server-ind1:8080;
    server regional-api-server-usa1:8080;
    server regional-api-server-deu1:8080;
}

upstream global_service {
    server global-service:8081;
}

server {
    listen 80;

    location /admin/ {
        proxy_pass http://global_service;
        # standard proxy headers
    }

    location / {
        proxy_pass http://regional_servers;
        # standard proxy headers
    }
}
```

3. Update admin-ui to set `VITE_API_BASE_URL` to point to the global service (port 8081) for direct access, OR keep using nginx (:8080) which routes `/admin/` to global service.

**Verification:** All tests pass. Admin tests now go through nginx → global-service. Regional tests go through nginx → regional-api-servers. From the test client's perspective, nothing changes (still hitting `:8080`).

---

### Phase 3: Isolate Regional DB Connections + Add Cross-Region Proxy

**Goal:** Each regional API server connects to only its own regional DB + global DB. Cross-region requests are handled via HTTP reverse proxy.

This is the most complex phase. Break it into sub-phases.

#### 3.1 Refactor Server Struct

Edit `/api-server/internal/server/server.go`:

```go
type Server struct {
    // Global database (for routing lookups)
    Global     *globaldb.Queries
    GlobalPool *pgxpool.Pool

    // This server's regional database (only one)
    Regional     *regionaldb.Queries
    RegionalPool *pgxpool.Pool

    // Server identity
    CurrentRegion globaldb.Region
    Log           *slog.Logger
    TokenConfig   *TokenConfig
    UIConfig      *UIConfig
    Environment   string

    // Internal endpoints for cross-region proxy
    // Map of region → base URL (e.g., "ind1" → "http://regional-api-server-ind1:8080")
    InternalEndpoints map[globaldb.Region]string
}
```

**Remove:**

- `RegionalIND1`, `RegionalUSA1`, `RegionalDEU1` (query fields)
- `RegionalIND1Pool`, `RegionalUSA1Pool`, `RegionalDEU1Pool` (pool fields)
- `SMTPConfig` (no longer needed in API server)
- `GetRegionalDB(region)` method
- `GetRegionalPool(region)` method
- `GetCurrentRegionalDB()` method

**Add:**

- `Regional` field (single regional DB)
- `RegionalPool` field (single regional pool)
- `InternalEndpoints` map
- `ProxyToRegion(w, r, targetRegion, bodyBytes)` method (see 3.2)

**Update `WithRegionalTx`:**

```go
// No longer needs pool parameter - always uses s.RegionalPool
func (s *Server) WithRegionalTx(ctx context.Context, fn func(*regionaldb.Queries) error) error {
    tx, err := s.RegionalPool.Begin(ctx)
    // ... same logic but using s.RegionalPool
}
```

Note: The old signature was `WithRegionalTx(ctx, pool, fn)` where pool was variable. The new signature is `WithRegionalTx(ctx, fn)` since there's only one regional pool.

#### 3.2 Add Cross-Region Proxy Utility

Create `/api-server/internal/proxy/proxy.go`:

```go
package proxy

import (
    "bytes"
    "io"
    "net/http"
    "net/http/httputil"
    "net/url"
)

// BufferBody reads and returns the request body, then restores it on the request
// so it can be read again by the handler.
func BufferBody(r *http.Request) ([]byte, error) {
    bodyBytes, err := io.ReadAll(r.Body)
    if err != nil {
        return nil, err
    }
    r.Body = io.NopCloser(bytes.NewReader(bodyBytes))
    return bodyBytes, nil
}

// ToRegion proxies the request to the specified region's internal endpoint.
// bodyBytes is the original request body (already consumed by the handler).
func ToRegion(w http.ResponseWriter, r *http.Request, targetURL string, bodyBytes []byte) {
    target, err := url.Parse(targetURL)
    if err != nil {
        http.Error(w, "", http.StatusInternalServerError)
        return
    }

    proxy := &httputil.ReverseProxy{
        Director: func(req *http.Request) {
            req.URL.Scheme = target.Scheme
            req.URL.Host = target.Host
            req.URL.Path = r.URL.Path
            req.URL.RawQuery = r.URL.RawQuery
            req.Host = target.Host

            // Restore the original body
            req.Body = io.NopCloser(bytes.NewReader(bodyBytes))
            req.ContentLength = int64(len(bodyBytes))

            // Copy all original headers (including Authorization)
            for key, values := range r.Header {
                for _, value := range values {
                    req.Header.Set(key, value)
                }
            }
        },
    }
    proxy.ServeHTTP(w, r)
}
```

Add helper method on Server:

```go
func (s *Server) ProxyToRegion(w http.ResponseWriter, r *http.Request, targetRegion globaldb.Region, bodyBytes []byte) {
    endpoint, ok := s.InternalEndpoints[targetRegion]
    if !ok {
        s.Logger(r.Context()).Error("no internal endpoint for region", "region", targetRegion)
        http.Error(w, "", http.StatusInternalServerError)
        return
    }
    proxy.ToRegion(w, r, endpoint, bodyBytes)
}
```

#### 3.3 Update Auth Middleware for Proxy

Edit `/api-server/internal/middleware/auth.go`:

The three regional auth middlewares (`HubAuth`, `OrgAuth`, `AgencyAuth`) currently:

1. Extract region from token prefix
2. Get regional DB for that region
3. Query session + user from that regional DB
4. Set context values

**New behavior:**

1. Extract region from token prefix
2. If region != current server's region → proxy to correct region, return
3. Query session + user from local regional DB
4. Set context values

The middleware signature changes:

**Before:**

```go
func HubAuth(getRegionalDB func(globaldb.Region) *regionaldb.Queries) func(http.Handler) http.Handler
```

**After:**

```go
func HubAuth(
    regionalDB *regionaldb.Queries,
    currentRegion globaldb.Region,
    internalEndpoints map[globaldb.Region]string,
) func(http.Handler) http.Handler
```

Inside the middleware, after extracting the region:

```go
if region != currentRegion {
    endpoint, ok := internalEndpoints[region]
    if !ok {
        // unknown region
        w.WriteHeader(http.StatusUnauthorized)
        return
    }
    // Buffer and proxy the request
    bodyBytes, _ := proxy.BufferBody(r)
    proxy.ToRegion(w, r, endpoint, bodyBytes)
    return
}
// Continue with local session validation using regionalDB
```

Same change for `OrgAuth` and `AgencyAuth`.

`AdminAuth` is unchanged (admin is on global service now, not on regional servers).

#### 3.4 Update Role Middleware

Edit `/api-server/internal/middleware/roles.go`:

The `EmployerRole` and `AgencyRole` middlewares currently take `getRegionalDB func(globaldb.Region)`:

**Before:**

```go
func EmployerRole(getRegionalDB func(globaldb.Region) *regionaldb.Queries, requiredRoles ...string) func(http.Handler) http.Handler
```

**After:**

```go
func EmployerRole(regionalDB *regionaldb.Queries, requiredRoles ...string) func(http.Handler) http.Handler
```

Since the auth middleware already handled the proxy (ensuring the request is on the correct server), the role middleware always uses the local regional DB.

Same change for `AgencyRole`.

Remove `AdminRole` from regional routes (admin is on global service now). `AdminRole` stays in the codebase for use by the global service.

#### 3.5 Update Route Registration

Edit files under `/api-server/internal/routes/`:

**hub-routes.go:**

```go
// Before:
func RegisterHubRoutes(mux *http.ServeMux, s *server.Server) {
    authMiddleware := middleware.HubAuth(s.GetRegionalDB)
    // ...
}

// After:
func RegisterHubRoutes(mux *http.ServeMux, s *server.Server) {
    authMiddleware := middleware.HubAuth(s.Regional, s.CurrentRegion, s.InternalEndpoints)
    // ...
}
```

Same pattern for `org-routes.go` and `agency-routes.go`.

Delete `admin-routes.go` (already done in Phase 2).

#### 3.6 Update Handlers to Proxy When Needed

For **authenticated handlers** (session token in Authorization header): No handler changes needed. The auth middleware handles proxy.

For **unauthenticated handlers with region-prefixed token in body**, add proxy logic at the top of the handler. The pattern is:

```go
func SomeHandler(s *server.Server) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        // Buffer body for potential proxy
        bodyBytes, err := proxy.BufferBody(r)
        if err != nil {
            http.Error(w, "", http.StatusBadRequest)
            return
        }

        // ... decode request from r.Body (which is restored by BufferBody) ...

        // Extract region from token
        region, rawToken, err := tokens.ExtractRegionFromToken(string(req.SomeToken))
        if err != nil { ... }

        // Proxy if wrong region
        if region != s.CurrentRegion {
            s.ProxyToRegion(w, r, region, bodyBytes)
            return
        }

        // Continue with local handling using s.Regional
    }
}
```

**Handlers that need this pattern:**

| Handler File                        | Token Field                           | Region Extraction               |
| ----------------------------------- | ------------------------------------- | ------------------------------- |
| `hub/tfa.go`                        | `req.TFAToken`                        | `tokens.ExtractRegionFromToken` |
| `hub/complete-password-reset.go`    | `req.ResetToken`                      | `tokens.ExtractRegionFromToken` |
| `hub/complete-email-change.go`      | `req.Token` (check actual field name) | `tokens.ExtractRegionFromToken` |
| `org/tfa.go`                        | `req.TFAToken`                        | `tokens.ExtractRegionFromToken` |
| `org/complete-password-reset.go`    | `req.ResetToken`                      | `tokens.ExtractRegionFromToken` |
| `org/complete-setup.go`             | `req.Token`                           | `tokens.ExtractRegionFromToken` |
| `agency/tfa.go`                     | `req.TFAToken`                        | `tokens.ExtractRegionFromToken` |
| `agency/complete-password-reset.go` | `req.ResetToken`                      | `tokens.ExtractRegionFromToken` |
| `agency/complete-setup.go`          | `req.Token`                           | `tokens.ExtractRegionFromToken` |

For **unauthenticated handlers that need global DB lookup to discover region**, the pattern is:

```go
func Login(s *server.Server) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        bodyBytes, err := proxy.BufferBody(r)
        if err != nil { ... }

        // ... decode + validate ...

        // Discover region from global DB
        emailHash := sha256.Sum256([]byte(loginRequest.EmailAddress))
        globalUser, err := s.Global.GetHubUserByEmailHash(ctx, emailHash[:])
        if err != nil { ... } // handle not found, etc.

        // Proxy if wrong region
        if globalUser.HomeRegion != s.CurrentRegion {
            s.ProxyToRegion(w, r, globalUser.HomeRegion, bodyBytes)
            return
        }

        // Continue with local handling using s.Regional
        regionalUser, err := s.Regional.GetHubUserByEmail(ctx, ...)
    }
}
```

**Handlers that need global DB lookup + proxy:**

| Handler File                       | How Region is Discovered                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `hub/login.go`                     | `Global.GetHubUserByEmailHash` → `HomeRegion`                                                          |
| `hub/request-password-reset.go`    | `Global.GetHubUserByEmailHash` → `HomeRegion`                                                          |
| `org/login.go`                     | `Global.GetEmployerByDomain` → employer, then `Global.GetOrgUserByEmailHashAndEmployer` → `HomeRegion` |
| `org/request-password-reset.go`    | Similar to org login                                                                                   |
| `agency/login.go`                  | `Global.GetAgencyByDomain` → agency, then `Global.GetAgencyUserByEmailHashAndAgency` → `HomeRegion`    |
| `agency/request-password-reset.go` | Similar to agency login                                                                                |

For **unauthenticated handlers with region in request body**, the pattern is:

```go
func CompleteSignup(s *server.Server) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        bodyBytes, err := proxy.BufferBody(r)
        if err != nil { ... }

        // ... decode + validate ...

        targetRegion := globaldb.Region(req.HomeRegion)

        // Proxy if wrong region
        if targetRegion != s.CurrentRegion {
            s.ProxyToRegion(w, r, targetRegion, bodyBytes)
            return
        }

        // Continue with local handling
    }
}
```

**Handlers that need body-field region check + proxy:**

| Handler File                | Body Field                                                   |
| --------------------------- | ------------------------------------------------------------ |
| `hub/complete-signup.go`    | `req.HomeRegion`                                             |
| `org/init-signup.go`        | `req.HomeRegion`                                             |
| `org/complete-signup.go`    | Look up token in global DB → `home_region` from token record |
| `agency/init-signup.go`     | `req.HomeRegion`                                             |
| `agency/complete-signup.go` | Look up token in global DB → `home_region` from token record |

For **handlers that don't need proxy** (work on any server):

| Handler File                        | Why No Proxy                                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `hub/request-signup.go`             | Uses global DB (signup token) + current regional DB (email queue). Any region's email queue is fine for signup emails. |
| `global/get-regions.go`             | Global DB read only                                                                                                    |
| `global/get-supported-languages.go` | Global DB read only                                                                                                    |
| `global/check-domain.go`            | Global DB read only                                                                                                    |
| `org/get-signup-details.go`         | Global DB read only                                                                                                    |
| `agency/get-signup-details.go`      | Global DB read only                                                                                                    |

#### 3.7 Update All Handler DB Access

Every handler that currently uses `s.GetRegionalDB(region)` or `s.GetRegionalPool(region)` must change to use `s.Regional` and `s.RegionalPool`.

**Before (in handlers after proxy check):**

```go
regionalDB := s.GetRegionalDB(globalUser.HomeRegion)
regionalPool := s.GetRegionalPool(globalUser.HomeRegion)
err = s.WithRegionalTx(ctx, regionalPool, func(qtx *regionaldb.Queries) error { ... })
```

**After:**

```go
// No need to get regional DB - we ARE the right region (proxy already handled)
err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error { ... })
```

This simplifies every handler. `s.Regional` is always the correct regional DB because the proxy middleware ensures the request is on the right server.

**Files that need `GetRegionalDB`/`GetRegionalPool` replacement:**

Search for all occurrences of `s.GetRegionalDB`, `s.GetRegionalPool`, `s.GetCurrentRegionalDB` across all handler files and replace with `s.Regional` / `s.RegionalPool`.

The `WithRegionalTx` signature change (removing pool parameter) affects every call site.

#### 3.8 Update `cmd/regional-api-server/main.go`

1. Remove 2 of the 3 regional DB connection strings. Keep only `REGIONAL_DB_CONN` (a single env var for this server's regional DB).
2. Parse new env var: `INTERNAL_ENDPOINTS` (JSON map or individual vars like `INTERNAL_ENDPOINT_IND1`, `INTERNAL_ENDPOINT_USA1`, `INTERNAL_ENDPOINT_DEU1`).
3. Create Server with only 2 DB pools:

```go
s := &server.Server{
    Global:       globaldb.New(globalPool),
    GlobalPool:   globalPool,
    Regional:     regionaldb.New(regionalPool),
    RegionalPool: regionalPool,
    CurrentRegion: region,
    InternalEndpoints: internalEndpoints,
    // ...
}
```

4. Remove unused DB connection code for other regions.

#### 3.9 Update Docker Compose

Update all 3 Docker Compose files:

**Regional API server services:**

```json
"regional-api-server-ind1": {
    "environment": {
        "REGION": "ind1",
        "GLOBAL_DB_CONN": "postgres://...:5432/vetchium",
        "REGIONAL_DB_CONN": "postgres://...:5433/vetchium_ind1",
        "INTERNAL_ENDPOINT_IND1": "http://regional-api-server-ind1:8080",
        "INTERNAL_ENDPOINT_USA1": "http://regional-api-server-usa1:8080",
        "INTERNAL_ENDPOINT_DEU1": "http://regional-api-server-deu1:8080"
    }
}
```

Note: the server's own endpoint is included so the config is uniform. The server just won't proxy to itself.

Remove env vars that are no longer used:

- `REGIONAL_DB_IND1_CONN`, `REGIONAL_DB_USA1_CONN`, `REGIONAL_DB_DEU1_CONN` → replaced by single `REGIONAL_DB_CONN`
- All SMTP env vars (moved to regional-worker)
- All email worker env vars (moved to regional-worker)
- All cleanup interval env vars (moved to regional-worker)

**Verification:** All tests pass. Cross-region requests are now proxied via HTTP between regional servers rather than direct DB access.

---

### Phase 4: Update Tests and CI

#### 4.1 Verify Existing Tests

All existing Playwright tests should pass without modification because:

- Nginx still fronts everything on port 8080
- Admin routes are proxied by nginx to global-service
- Regional routes hit regional servers, which proxy cross-region requests internally
- From the test client's perspective, the API behaves identically

#### 4.2 Add Cross-Region Proxy Tests (Optional)

Consider adding tests that verify:

- A hub user created in IND1 can log in when the request hits any regional server
- TFA tokens with region prefix work correctly across proxy
- Password reset tokens work across proxy
- Org signup with a specific region works when request hits a different server

These tests would be valuable for regression but are not strictly necessary if existing tests already exercise cross-region scenarios (which they likely do since Docker Compose uses round-robin LB).

#### 4.3 Update Test Helpers if Needed

If test helpers in `playwright/lib/db.ts` create data directly in specific regional DBs, verify they still work. Since helpers use direct DB connections (not the API), they should be unaffected.

---

## Detailed File Change List

### New Files

| File                                     | Phase | Description                                 |
| ---------------------------------------- | ----- | ------------------------------------------- |
| `cmd/regional-worker/main.go`            | 1     | Regional worker entry point                 |
| `Dockerfile.regional-worker`             | 1     | Docker build for regional worker            |
| `cmd/global-service/main.go`             | 2     | Global service entry point                  |
| `Dockerfile.global-service`              | 2     | Docker build for global service             |
| `internal/server/global_server.go`       | 2     | GlobalServer struct for admin handlers      |
| `internal/routes/admin-global-routes.go` | 2     | Admin route registration for global service |
| `internal/email/db.go`                   | 2     | EmailDB interface for generic email worker  |
| `internal/proxy/proxy.go`                | 3     | Cross-region proxy utility                  |

### Modified Files

| File                                                     | Phase | Change                                                                              |
| -------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------- |
| `cmd/regional-api-server/main.go`                        | 1,3   | Phase 1: remove worker startup. Phase 3: single regional DB, add internal endpoints |
| `docker-compose-ci.json`                                 | 1,2,3 | Add workers, global service, update env vars                                        |
| `docker-compose-full.json`                               | 1,2,3 | Same                                                                                |
| `docker-compose-backend.json`                            | 1,2,3 | Same                                                                                |
| `nginx/api-lb.conf`                                      | 2     | Add global_service upstream, admin location block                                   |
| `internal/server/server.go`                              | 3     | Remove cross-region DB fields, add InternalEndpoints                                |
| `internal/server/tx.go`                                  | 3     | Simplify WithRegionalTx signature                                                   |
| `internal/middleware/auth.go`                            | 3     | Add proxy logic, change signatures                                                  |
| `internal/middleware/roles.go`                           | 3     | Simplify signatures (single regional DB)                                            |
| `internal/routes/hub-routes.go`                          | 2,3   | Phase 2: remove admin registration call. Phase 3: update middleware calls           |
| `internal/routes/org-routes.go`                          | 3     | Update middleware calls                                                             |
| `internal/routes/agency-routes.go`                       | 3     | Update middleware calls                                                             |
| `internal/routes/global-routes.go`                       | -     | No change (global routes don't use regional DB)                                     |
| `internal/email/worker.go`                               | 2     | Accept EmailDB interface instead of \*regionaldb.Queries                            |
| `internal/tokens/regional.go`                            | -     | No change (already handles region extraction)                                       |
| `db/migrations/global/00000000000001_initial_schema.sql` | 2     | Add emails + email_delivery_attempts tables                                         |
| `db/queries/global.sql`                                  | 2     | Add email queue queries                                                             |
| `sqlc.yaml`                                              | -     | No change (already has global + regional)                                           |
| All 15 `handlers/admin/*.go`                             | 2     | Change receiver to \*GlobalServer, use global email queue                           |
| All 10 `handlers/hub/*.go`                               | 3     | Add proxy logic, use s.Regional instead of s.GetRegionalDB                          |
| All 18 `handlers/org/*.go`                               | 3     | Add proxy logic, use s.Regional instead of s.GetRegionalDB                          |
| All 16 `handlers/agency/*.go`                            | 3     | Add proxy logic, use s.Regional instead of s.GetRegionalDB                          |
| `handlers/global/*.go` (3 files)                         | -     | No change (global DB only)                                                          |

### Deleted Files

| File                              | Phase | Reason                                |
| --------------------------------- | ----- | ------------------------------------- |
| `cmd/global-api-server/main.go`   | 2     | Replaced by cmd/global-service        |
| `Dockerfile.global`               | 2     | Replaced by Dockerfile.global-service |
| `internal/routes/admin-routes.go` | 2     | Admin routes move to global service   |

---

## Environment Variables Reference

### regional-api-server (Phase 3 final state)

```
REGION=ind1
ENV=ci|full
LOG_LEVEL=debug

# Database (2 connections)
GLOBAL_DB_CONN=postgres://...
REGIONAL_DB_CONN=postgres://...

# Cross-region proxy
INTERNAL_ENDPOINT_IND1=http://regional-api-server-ind1:8080
INTERNAL_ENDPOINT_USA1=http://regional-api-server-usa1:8080
INTERNAL_ENDPOINT_DEU1=http://regional-api-server-deu1:8080

# Token config (hub, org, agency - NOT admin)
HUB_SIGNUP_TOKEN_EXPIRY=24h
HUB_TFA_TOKEN_EXPIRY=10m
HUB_SESSION_TOKEN_EXPIRY=24h
HUB_REMEMBER_ME_EXPIRY=8760h
ORG_SIGNUP_TOKEN_EXPIRY=24h
ORG_TFA_TOKEN_EXPIRY=10m
ORG_SESSION_TOKEN_EXPIRY=24h
ORG_REMEMBER_ME_EXPIRY=8760h
AGENCY_SIGNUP_TOKEN_EXPIRY=24h
AGENCY_TFA_TOKEN_EXPIRY=10m
AGENCY_SESSION_TOKEN_EXPIRY=24h
AGENCY_REMEMBER_ME_EXPIRY=8760h
PASSWORD_RESET_TOKEN_EXPIRY=1h
EMAIL_VERIFICATION_TOKEN_EXPIRY=1h
ORG_INVITATION_TOKEN_EXPIRY=168h
AGENCY_INVITATION_TOKEN_EXPIRY=168h

# UI URLs (for email link generation)
HUB_UI_URL=http://localhost:3000
ORG_UI_URL=http://localhost:3002
AGENCY_UI_URL=http://localhost:3003

CORS_ALLOWED_ORIGINS=*
```

### regional-worker

```
REGION=ind1
LOG_LEVEL=debug

# Database (1 connection)
REGIONAL_DB_CONN=postgres://...

# SMTP
SMTP_HOST=mailpit
SMTP_PORT=1025

# Email worker
EMAIL_WORKER_BATCH_SIZE=10
EMAIL_WORKER_POLL_INTERVAL=30s
EMAIL_WORKER_MAX_ATTEMPTS=5

# Cleanup intervals
CLEANUP_HUB_TFA_TOKENS_INTERVAL=1h
CLEANUP_HUB_SESSIONS_INTERVAL=1h
CLEANUP_HUB_PASSWORD_RESET_TOKENS_INTERVAL=1h
CLEANUP_HUB_EMAIL_VERIFICATION_TOKENS_INTERVAL=1h
CLEANUP_ORG_TFA_TOKENS_INTERVAL=1h
CLEANUP_ORG_SESSIONS_INTERVAL=1h
CLEANUP_ORG_PASSWORD_RESET_TOKENS_INTERVAL=1h
CLEANUP_AGENCY_TFA_TOKENS_INTERVAL=1h
CLEANUP_AGENCY_SESSIONS_INTERVAL=1h
CLEANUP_AGENCY_PASSWORD_RESET_TOKENS_INTERVAL=1h
```

### global-service

```
LOG_LEVEL=debug

# Database (1 connection)
GLOBAL_DB_CONN=postgres://...

# SMTP
SMTP_HOST=mailpit
SMTP_PORT=1025

# Email worker
EMAIL_WORKER_BATCH_SIZE=10
EMAIL_WORKER_POLL_INTERVAL=30s
EMAIL_WORKER_MAX_ATTEMPTS=5

# Token config (admin only)
ADMIN_TFA_TOKEN_EXPIRY=10m
ADMIN_SESSION_TOKEN_EXPIRY=24h
ADMIN_INVITATION_TOKEN_EXPIRY=168h
ADMIN_PASSWORD_RESET_TOKEN_EXPIRY=1h

# Global cleanup intervals
CLEANUP_ADMIN_TFA_TOKENS_INTERVAL=1h
CLEANUP_ADMIN_SESSIONS_INTERVAL=1h
CLEANUP_ADMIN_PASSWORD_RESET_TOKENS_INTERVAL=1h
CLEANUP_HUB_SIGNUP_TOKENS_INTERVAL=1h
CLEANUP_ORG_SIGNUP_TOKENS_INTERVAL=1h
CLEANUP_AGENCY_SIGNUP_TOKENS_INTERVAL=1h

# UI URLs
ADMIN_UI_URL=http://localhost:3001

CORS_ALLOWED_ORIGINS=*
```

---

## Kubernetes Deployment Notes

The Docker Compose architecture maps to Kubernetes as follows:

### Deployments

| K8s Resource                              | Replicas | Notes                                                                                                                                                                                                    |
| ----------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `regional-api-server-{region}` Deployment | N (HPA)  | Stateless, scales on CPU/request count                                                                                                                                                                   |
| `regional-worker-{region}` Deployment     | 1        | Singleton. Use `replicas: 1` and `strategy: Recreate` to prevent duplicate workers                                                                                                                       |
| `global-service` Deployment               | 1-2      | Low traffic (admin only). Can scale if needed since HTTP is stateless. Global cleanup + email worker should only run in one pod - consider leader election or separate into its own singleton deployment |

### Services

| K8s Service             | Type                  | Target                                     |
| ----------------------- | --------------------- | ------------------------------------------ |
| `regional-api-{region}` | ClusterIP             | regional-api-server pods in that region    |
| `global-service`        | ClusterIP             | global-service pods                        |
| `api-ingress`           | Ingress + ExternalDNS | Anycast DNS → closest region's API service |
| `admin-api-ingress`     | Ingress               | admin-api.vetchium.com → global-service    |

### DNS and Routing

- `api.vetchium.com` → Anycast DNS → resolves to closest regional cluster
- Each regional cluster runs its own Ingress controller
- The Ingress routes to `regional-api-server` pods in that cluster
- `admin-api.vetchium.com` → standard DNS → global-service cluster

### Cross-Region Communication

- Internal endpoints use Kubernetes Service DNS: `regional-api-ind1.vetchium.svc.cluster.local`
- For multi-cluster: use service mesh (Istio, Linkerd) or explicit cross-cluster DNS
- Cross-region traffic goes over private network / VPN between clusters

### Database

- Each region runs its own PostgreSQL (or managed: RDS, Cloud SQL, AlloyDB)
- Global DB runs in a central location (or use read replicas in each region for routing lookups)
- Consider read replicas of global DB in each region to reduce cross-region latency for routing lookups

### Scaling Considerations

- Regional API servers scale independently per region based on traffic
- Regional workers are singletons - if the pod dies, K8s restarts it
- Global DB read replicas can be added per region to reduce global lookup latency
- Connection pooling: consider PgBouncer sidecars for regional API servers with many replicas

---

## Migration Checklist

- [ ] Phase 1: Create regional-worker binary
- [ ] Phase 1: Update Docker Compose with worker services
- [ ] Phase 1: Remove worker code from regional-api-server
- [ ] Phase 1: Verify all tests pass
- [ ] Phase 2: Add email tables to global schema
- [ ] Phase 2: Add email queries to global.sql
- [ ] Phase 2: Run sqlc generate
- [ ] Phase 2: Create EmailDB interface for generic email worker
- [ ] Phase 2: Create GlobalServer struct
- [ ] Phase 2: Adapt admin handlers to GlobalServer
- [ ] Phase 2: Create admin-global-routes.go
- [ ] Phase 2: Create global-service binary
- [ ] Phase 2: Create Dockerfile.global-service
- [ ] Phase 2: Remove admin routes from regional server
- [ ] Phase 2: Update nginx to route /admin to global service
- [ ] Phase 2: Update Docker Compose
- [ ] Phase 2: Delete old global-api-server files
- [ ] Phase 2: Verify all tests pass
- [ ] Phase 3: Create proxy utility package
- [ ] Phase 3: Refactor Server struct (remove cross-region DB fields)
- [ ] Phase 3: Update WithRegionalTx signature
- [ ] Phase 3: Update auth middleware with proxy logic
- [ ] Phase 3: Update role middleware signatures
- [ ] Phase 3: Update route registration
- [ ] Phase 3: Add proxy logic to unauthenticated handlers (token-prefix based)
- [ ] Phase 3: Add proxy logic to login handlers (global DB lookup based)
- [ ] Phase 3: Add proxy logic to signup handlers (body field based)
- [ ] Phase 3: Replace all GetRegionalDB/GetRegionalPool/GetCurrentRegionalDB calls
- [ ] Phase 3: Update cmd/regional-api-server/main.go (single regional DB + internal endpoints)
- [ ] Phase 3: Update Docker Compose env vars
- [ ] Phase 3: Verify all tests pass
- [ ] Phase 4: Add cross-region proxy tests (optional)
