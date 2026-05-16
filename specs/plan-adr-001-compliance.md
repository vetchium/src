# Plan — ADR-001 Compliance Migration

Status: Ready for implementation
Owner: TBD (cheaper AI)
Source spec: `specs/adr-001-multi-region-data-access.md`
Date authored: 2026-05-16

This document is the **sole input** the implementing AI needs. Every change is concrete: file paths, env-var names, function signatures. Do not invent architecture; if something is ambiguous, stop and ask.

---

## 0. Background — what is and isn't compliant today

ADR-001 (already merged) records that Option A (full cross-region read-write DB pools on every regional API server) is the chosen design. Option E (inter-regional HTTP proxy with session-token forwarding) is **rejected** in §4.5 and empirically rejected in §5 because it produces a structural infinite proxy loop.

The codebase is **not yet compliant**:

1. `api-server/internal/proxy/proxy.go` exists and implements `proxy.BufferBody` + `proxy.ToRegion` (Option E machinery).
2. `RegionalServer.InternalEndpoints` is populated and `RegionalServer.ProxyToRegion(...)` is the canonical cross-region call. ~25 handler call sites use it.
3. `middleware.HubAuth` and `middleware.OrgAuth` (in `api-server/internal/middleware/auth.go`) implement the exact "auth middleware proxies based on token prefix" pattern that ADR §5 calls out as the loop trigger.
4. `RegionalServer.AllRegionalDBs` (a `map[Region]*regionaldb.Queries`) is wired by `cmd/regional-api-server/main.go` and is the Option-A substrate, but only `handlers/hub/connections.go` actually reads from it today.
5. S3 is single-bucket / single-endpoint: `S3_ENDPOINT`, `S3_BUCKET` are global env vars in all three compose files, and one shared `localstack` instance serves all regions.
6. `docker-compose-backend.json` and `docker-compose-full.json` do not even set `REGIONAL_DB_CONN_*` on the regional API servers — only `docker-compose-ci.json` does. They are inconsistent with each other.
7. `StorageConfig` doc comment in `internal/server/server.go` (lines 53–58) still says "the request is proxied to the appropriate regional API server, which then reads/writes its own Garage instance" — Option E language, stale.

The implementing AI's job is to make the codebase, the three compose files, and the ADR figures all match Option A as described in the (updated) ADR.

---

## 1. ADR fixes to apply first

Two errors in the ADR itself must be fixed before the rest of the work, so the target architecture is canonical.

### 1.1 ADR text — §1.1 table

Open `specs/adr-001-multi-region-data-access.md`. Replace the row in the §1.1 Infrastructure table that reads:

```
| Object Storage (S3-compatible) | 1                                    | Profile pictures and file uploads. |
```

with:

```
| Object Storage (S3-compatible) | N (one per region)                   | Profile pictures and file uploads. Each region has its own bucket reached via its own S3 endpoint, mirroring the regional DB topology. |
```

### 1.2 ADR text — new §1.4

After §1.3 (Session Token Format) and before §2, add a new subsection:

```markdown
### 1.4 Regional Object Storage

Object storage is regional in the same sense as the database: each region has its own
S3-compatible endpoint and bucket (`vetchium-ind1`, `vetchium-usa1`, `vetchium-deu1`,
…). Binary blobs follow the entity's home region — a hub user's profile picture is
written to and read from their home region's bucket, addressed by a region-prefixed S3
key (`profiles/{hub_user_global_id}/{filename}`). API servers hold one S3 client per
region, selected at call time based on the owning entity's home region, exactly as for
the database pools described in §4.1.
```

### 1.3 ADR text — §8.2 amendment

In §8.2 ("Negative"), add a fourth bullet:

```markdown
**Per-region S3 client multiplexing.** Each regional API server instantiates N S3
clients (one per region) using N endpoint/credential triples. Misrouting a write to the
wrong bucket is a code-convention risk identical to misrouting a DB write, and is
mitigated the same way (explicit pool/client selection per call, PR review).
```

### 1.4 SVG — `specs/figures/fig1-topology.svg`

Open `specs/figures/fig1-topology.svg`. Two corrections:

**(a) Wrong arrow origin.** The three lines on lines 97–99 currently start at `y1="300"` (the bottom of each Regional DB box) and end at the Global DB — implying a Regional-DB-to-Global-DB relationship that does not exist. Move the arrow origin up to the bottom of each API Server box (`y1="183"`) and re-route them as curved paths so they bypass the Regional DB boxes:

Replace lines 97–99 with:

```svg
  <!-- All API Servers → Global DB (bypassing Regional DBs) -->
  <path d="M 136 183 C 100 320, 180 360, 278 400" stroke="#1565c0" stroke-width="1" fill="none" marker-end="url(#arr-blue)"/>
  <path d="M 355 183 C 355 280, 355 340, 355 375" stroke="#1565c0" stroke-width="1" fill="none" marker-end="url(#arr-blue)"/>
  <path d="M 574 183 C 610 320, 530 360, 452 400" stroke="#1565c0" stroke-width="1" fill="none" marker-end="url(#arr-blue)"/>
```

**(b) Add per-region object storage to the figure.** Below the legend (after line 109's `</svg>` — actually just before it) insert a row of three S3 bucket boxes co-located visually with each regional DB. To keep the change minimal, add a single explanatory annotation in the legend area:

Replace the legend block (lines 102–108) with:

```svg
  <!-- Legend -->
  <rect x="30" y="442" width="680" height="18" rx="3" fill="#fff" stroke="#e0e0e0" stroke-width="1"/>
  <line x1="42" y1="451" x2="62" y2="451" stroke="#fb8c00" stroke-width="2"/>
  <text x="67" y="455" font-family="sans-serif" font-size="9" fill="#333">home-region r/w (primary; DB + S3)</text>
  <line x1="240" y1="451" x2="260" y2="451" stroke="#bdbdbd" stroke-width="1" stroke-dasharray="3,3"/>
  <text x="265" y="455" font-family="sans-serif" font-size="9" fill="#333">cross-region r/w — Option A (all servers reach all regional DBs + buckets)</text>
  <line x1="588" y1="451" x2="608" y2="451" stroke="#1565c0" stroke-width="1"/>
  <text x="613" y="455" font-family="sans-serif" font-size="9" fill="#333">global DB (routing only)</text>
```

No changes to `fig2-placement.svg` or `fig3-proxy-loop.svg` — they are correct.

---

## 2. Code refactor (api-server)

All code changes live under `/Users/psankar/vetchium/src/api-server/`. Work in this order; do not skip ahead.

### 2.1 Server types and helpers

**File:** `internal/server/server.go`

1. Rewrite the `StorageConfig` doc comment (lines 53–58) to:

   ```go
   // StorageConfig holds S3-compatible object storage connection parameters for one
   // region. Each regional API server holds N StorageConfig values (one per region) in
   // RegionalServer.AllStorageConfigs, addressed by globaldb.Region. The correct
   // config for any blob operation is selected by the owning entity's home region —
   // mirroring the DB pool selection convention from ADR-001 §4.1.
   ```

2. In `BaseServer`, **remove** the `StorageConfig *StorageConfig` field (line 76) and the `BaseServer.GetStorageConfig()` method (lines 89–91). Storage is no longer base-server-wide.

3. The `PublicServer` interface (lines 79–83) currently returns `*StorageConfig`. Drop `GetStorageConfig()` from the interface — public handlers (`handlers/public/tag-icon.go`) will need a different mechanism; see §2.5.

4. In `RegionalServer`:
   - **Add** `AllRegionalPools map[globaldb.Region]*pgxpool.Pool` (parallels `AllRegionalDBs`).
   - **Add** `AllStorageConfigs map[globaldb.Region]*StorageConfig` (replaces the single `StorageConfig`).
   - **Remove** `InternalEndpoints map[globaldb.Region]string` (line 108).
   - **Add** `GetRegionalPool(region globaldb.Region) *pgxpool.Pool { return s.AllRegionalPools[region] }`.
   - **Add** `GetStorageConfig(region globaldb.Region) *StorageConfig { return s.AllStorageConfigs[region] }`.

5. **Delete** `RegionalServer.ProxyToRegion(...)` (lines 129–138) and remove the `proxy` import.

6. **Add** a new helper on `RegionalServer`:

   ```go
   // WithRegionalTxFor executes fn within a transaction on the given region's DB.
   // Use this when the home region of the entity being written differs from
   // s.CurrentRegion. For writes against s.CurrentRegion, prefer the shorter
   // WithRegionalTx (which is equivalent to WithRegionalTxFor(ctx, s.CurrentRegion, fn)).
   func (s *RegionalServer) WithRegionalTxFor(ctx context.Context, region globaldb.Region, fn func(*regionaldb.Queries) error) error {
       pool, ok := s.AllRegionalPools[region]
       if !ok || pool == nil {
           return fmt.Errorf("no pool for region %q", region)
       }
       return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
           return regionaldb.New(pool).WithTx(tx)... // see internal/server/tx.go for shape
       })
   }
   ```

   Look at `internal/server/tx.go` for the precise pattern of the existing `WithRegionalTx`; mirror it. **Do not** remove the existing `WithRegionalTx(ctx, fn)` — many handlers still call it for same-region writes.

**File:** `internal/server/global_server.go`

1. **Remove** `InternalEndpoints map[globaldb.Region]string` and its accessor if any.
2. The existing `WithRegionalTx(ctx, region, fn)` already takes a region — keep it as-is.

### 2.2 Auth middleware — kill the proxy branch

**File:** `internal/middleware/auth.go`

Both `HubAuth` and `OrgAuth` currently:

- accept `(regionalDB, currentRegion, internalEndpoints)`
- if token prefix region ≠ currentRegion → proxy to the home region's API server and return

Change both to:

- accept `(allRegionalDBs map[globaldb.Region]*regionaldb.Queries)` only
- extract region from the token prefix
- look up `regionalDB := allRegionalDBs[region]`; if nil → 401 ("unknown region in token")
- call `GetHubSession` / `GetOrgSession` against `regionalDB` (the home region's queries), **not** the local server's DB
- everything downstream (user lookup, status check, context storage) uses the same `regionalDB`

`HubRegionFromContext` and `OrgRegionFromContext` continue to carry the home region into handler context — handlers will use it to pick the right pool / queries / S3 client.

Remove the `proxy` import from this file. The `currentRegion` parameter is no longer needed by the middleware; it's still meaningful to `RegionalServer.CurrentRegion` for other reasons but the middleware no longer cares.

### 2.3 Handler refactor — replace every `ProxyToRegion` call with direct cross-region DB work

There are ~25 call sites (full list at the end of this section). The transformation pattern is uniform. **Apply this pattern to every site.**

#### Before

```go
bodyBytes, err := proxy.BufferBody(r)
if err != nil { http.Error(w, "", 400); return }

var req hub.HubLoginRequest
if err := json.NewDecoder(r.Body).Decode(&req); err != nil { ... }
if errs := req.Validate(); len(errs) > 0 { ... }

globalUser, err := s.Global.GetHubUserByEmailHash(ctx, hash[:])
...

// Proxy to correct region if needed
if globalUser.HomeRegion != s.CurrentRegion {
    s.ProxyToRegion(w, r, globalUser.HomeRegion, bodyBytes)
    return
}

regionalUser, err := s.Regional.GetHubUserByEmail(ctx, req.EmailAddress)
...
err = s.WithRegionalTx(ctx, func(qtx *regionaldb.Queries) error { ... })
```

#### After

```go
// (no proxy.BufferBody — body is read exactly once)
var req hub.HubLoginRequest
if err := json.NewDecoder(r.Body).Decode(&req); err != nil { ... }
if errs := req.Validate(); len(errs) > 0 { ... }

globalUser, err := s.Global.GetHubUserByEmailHash(ctx, hash[:])
...

// Select the home region's DB queries and tx helper. No proxy.
homeRegion := globalUser.HomeRegion
homeDB := s.GetRegionalDB(homeRegion)
if homeDB == nil {
    s.Logger(ctx).Error("no regional pool for home region", "region", homeRegion)
    http.Error(w, "", http.StatusInternalServerError); return
}

regionalUser, err := homeDB.GetHubUserByEmail(ctx, req.EmailAddress)
...
err = s.WithRegionalTxFor(ctx, homeRegion, func(qtx *regionaldb.Queries) error { ... })
```

Rules for the transformation:

1. **Delete** every `proxy.BufferBody` call and remove the `proxy` import from each touched file.
2. **Replace** every `s.ProxyToRegion(w, r, region, bodyBytes)` block with the home-region DB selection above. The handler now runs to completion on the receiving server.
3. **Replace** `s.Regional.<Query>` with `homeDB.<Query>` for any query against the home-region DB.
4. **Replace** `s.WithRegionalTx(ctx, fn)` with `s.WithRegionalTxFor(ctx, homeRegion, fn)` for the same reason.
5. Where the existing code already uses `s.GetRegionalDB(region)` or `s.AllRegionalDBs[...]` (e.g. `handlers/hub/connections.go` eligibility checks), keep it; that's already Option A.
6. **Do not** introduce any new branching on `s.CurrentRegion`. The whole point of Option A is that no handler should care which region it landed on.

#### Full call-site list (proxy / ProxyToRegion uses)

Apply the transformation above to each. The line numbers are from the current tree and may shift; grep `proxy.BufferBody\|ProxyToRegion` after each edit to find what's left.

- `handlers/hub/login.go:32, 76`
- `handlers/hub/tfa.go:26, 71`
- `handlers/hub/complete-signup.go:30, 136`
- `handlers/hub/request-password-reset.go:30, 76`
- `handlers/hub/complete-password-reset.go:22, 57`
- `handlers/hub/complete-email-change.go:24` (+ proxy use elsewhere in the file)
- `handlers/hub/work_emails.go:981`
- `handlers/hub/profile.go:722, 757, 849` (also: S3 — see §2.5)
- `handlers/hub/connections.go:175, 254, 434, 480, 569, 613, 666, 710, 781, 824`
- `handlers/org/login.go:34, 98`
- `handlers/org/tfa.go:26, 71`
- `handlers/org/init-signup.go:35, 72`
- `handlers/org/complete-signup.go:29, 106`
- `handlers/org/complete-setup.go:23, 67`
- `handlers/org/request-password-reset.go:29, 98`
- `handlers/org/complete-password-reset.go:22, 57`

**Acceptance check:** `grep -rn "internal/proxy\|ProxyToRegion\|proxy.BufferBody\|proxy.ToRegion" api-server/` must return zero matches when this section is done.

### 2.4 Route wiring

**File:** `internal/routes/hub-routes.go` (line 22)

Change:

```go
hubAuth := middleware.HubAuth(s.Regional, s.CurrentRegion, s.InternalEndpoints)
```

to:

```go
hubAuth := middleware.HubAuth(s.AllRegionalDBs)
```

**File:** `internal/routes/org-routes.go` (line 24)

Change:

```go
orgAuth := middleware.OrgAuth(s.Regional, s.CurrentRegion, s.InternalEndpoints)
```

to:

```go
orgAuth := middleware.OrgAuth(s.AllRegionalDBs)
```

### 2.5 Per-region S3 client selection

**Files touched:**

- `handlers/hub/profile.go` (profile picture upload/download/delete)
- `handlers/admin/tag-helpers.go`, `handlers/admin/upload-tag-icon.go`, `handlers/admin/delete-tag-icon.go`
- `handlers/public/tag-icon.go`

#### Hub profile pictures (regional, per home region)

Currently `handlers/hub/profile.go` does `uploadProfileImageToS3(ctx, s.StorageConfig, key, ...)`. After §2.1 there is no `s.StorageConfig`. Replace with:

```go
homeRegion := globalHubUser.HomeRegion       // from the global lookup already in the handler
cfg := s.GetStorageConfig(homeRegion)
if cfg == nil { http.Error(w, "", 500); return }
// upload / download / delete using cfg
```

The S3 key may remain unchanged (the bucket is already per-region; the key does not need to encode region). Any helper that constructs an S3 client (`newProfileS3Client`) must take a `*StorageConfig` parameter — it already does, so the only change is the caller.

#### Admin tag icons (global concept) and public tag icon GET

Tag icons are a global, admin-managed concept (`marketplace_capability_translations` etc. live in Global DB per the project memory). They have **no per-entity home region**. Two options were considered:

- **(chosen)** Store tag icons in the **global service's S3 endpoint**, which is one of the regional endpoints designated as the "global S3" (use the env var `GLOBAL_S3_REGION` — see §3 — to pick which one).
- (rejected) Replicate tag icons to all regional buckets — replication = consistency problem, not justified for an admin-managed artifact.

In code:

- `internal/server/global_server.go` (`GlobalServer`): add `StorageConfig *StorageConfig` (one config, used for admin-managed assets — populated from the global service's env vars).
- `handlers/admin/tag-helpers.go`, `handlers/admin/upload-tag-icon.go`, `handlers/admin/delete-tag-icon.go`: use `s.StorageConfig` (the `GlobalServer.StorageConfig`).
- `handlers/public/tag-icon.go`: this handler lives in the **regional** API server's routes today (it serves a public GET, no auth). It needs read access to the global tag-icon bucket. Easiest: add a fourth field `RegionalServer.GlobalStorageConfig *StorageConfig` and have `handlers/public/tag-icon.go` use that. Public handlers do not select by entity region; they read the one bucket where the icon lives.

`PublicServer.GetStorageConfig()` is removed from the interface in §2.1 — replace the call sites with concrete server access (or expose a new `GetGlobalStorageConfig()` on the public-server interface; the concrete approach is cleaner — the existing `PublicServer` interface in `server.go` only has three methods and `tag-icon.go` is the one consumer, so a `GetGlobalStorageConfig()` method on `RegionalServer` is acceptable).

### 2.6 cmd/main.go wiring

**File:** `cmd/regional-api-server/main.go`

1. **Remove** the `internalEndpoints` map (lines 80–85) and its env-var reads.
2. After building `allRegionalDBs`, also build a parallel `allRegionalPools map[globaldb.Region]*pgxpool.Pool`:

   ```go
   allRegionalPools := map[globaldb.Region]*pgxpool.Pool{ currentRegion: regionalConn }
   ```

   Inside the loop where `allRegionalDBs[rgn]` is set, also set `allRegionalPools[rgn] = pool`.

3. **Replace** the single `storageConfig` (lines 87–93) with a per-region map:

   ```go
   allStorageConfigs := map[globaldb.Region]*server.StorageConfig{}
   for _, rgn := range []globaldb.Region{globaldb.RegionInd1, globaldb.RegionUsa1, globaldb.RegionDeu1} {
       suffix := strings.ToUpper(string(rgn))    // "IND1", "USA1", "DEU1"
       endpoint := os.Getenv("S3_ENDPOINT_" + suffix)
       bucket   := os.Getenv("S3_BUCKET_"   + suffix)
       if endpoint == "" || bucket == "" {
           logger.Warn("missing S3 config for region", "region", rgn)
           continue
       }
       allStorageConfigs[rgn] = &server.StorageConfig{
           Endpoint:        endpoint,
           AccessKeyID:     os.Getenv("S3_ACCESS_KEY_ID_"     + suffix),
           SecretAccessKey: os.Getenv("S3_SECRET_ACCESS_KEY_" + suffix),
           Region:          os.Getenv("S3_REGION_"            + suffix),
           Bucket:          bucket,
       }
   }
   ```

4. Also read the global storage config (one set of env vars without a region suffix, served by whichever region hosts admin/global assets):

   ```go
   globalStorageConfig := &server.StorageConfig{
       Endpoint:        os.Getenv("GLOBAL_S3_ENDPOINT"),
       AccessKeyID:     os.Getenv("GLOBAL_S3_ACCESS_KEY_ID"),
       SecretAccessKey: os.Getenv("GLOBAL_S3_SECRET_ACCESS_KEY"),
       Region:          os.Getenv("GLOBAL_S3_REGION"),
       Bucket:          os.Getenv("GLOBAL_S3_BUCKET"),
   }
   ```

5. Construct `RegionalServer` with the new fields:

   ```go
   s := &server.RegionalServer{
       BaseServer: server.BaseServer{
           Global: globaldb.New(globalConn), GlobalPool: globalConn,
           Log: logger, TokenConfig: tokenConfig, UIConfig: uiConfig, Environment: environment,
       },
       Regional:            regionaldb.New(regionalConn),
       RegionalPool:        regionalConn,
       AllRegionalDBs:      allRegionalDBs,
       AllRegionalPools:    allRegionalPools,
       AllStorageConfigs:   allStorageConfigs,
       GlobalStorageConfig: globalStorageConfig,
       CurrentRegion:       currentRegion,
   }
   ```

**File:** `cmd/global-service/main.go`

1. **Remove** the `internalEndpoints` map (lines 98–102) and its env-var reads.
2. Drop those fields from `GlobalServer{}` construction (line 116).
3. Replace the single `S3_*` read with the **global** S3 env vars:

   ```go
   storageConfig := &server.StorageConfig{
       Endpoint:        os.Getenv("GLOBAL_S3_ENDPOINT"),
       AccessKeyID:     os.Getenv("GLOBAL_S3_ACCESS_KEY_ID"),
       SecretAccessKey: os.Getenv("GLOBAL_S3_SECRET_ACCESS_KEY"),
       Region:          os.Getenv("GLOBAL_S3_REGION"),
       Bucket:          os.Getenv("GLOBAL_S3_BUCKET"),
   }
   ```

   Assign to `GlobalServer.StorageConfig` (new field — see §2.5).

**File:** `cmd/regional-worker/main.go`

Workers are single-region by design (they own background jobs for their region's DB). No cross-region pool changes needed. If they use S3 (check with `grep -n "S3_\|StorageConfig" cmd/regional-worker/`), wire only the worker's own regional S3 config from `S3_ENDPOINT_<REGION>` etc.

### 2.7 Delete the proxy package

After §2.2 and §2.3, run `grep -rn "internal/proxy" api-server/`. If the only remaining hits are the package files themselves, delete the directory:

```
rm -r api-server/internal/proxy
```

Remove any leftover import of `vetchium-api-server.gomodule/internal/proxy` and run `goimports -w` over the touched files.

### 2.8 Build & lint

After all of §2:

```
cd api-server && sqlc generate && go build ./... && go vet ./...
```

Must pass with zero errors. Run `goimports -w .` to normalise imports.

---

## 3. Environment variable contract

All three compose files must agree on the env vars below.

### 3.1 Regional API servers (one entry per region; the `IND1/USA1/DEU1` suffix denotes the _target_ region, not the server's home region — every regional server gets all of them)

| Var name                                        | Example value                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| `REGION`                                        | `ind1`                                                                     |
| `GLOBAL_DB_CONN`                                | `postgres://...@global-db:5432/vetchium_global?sslmode=disable`            |
| `REGIONAL_DB_CONN`                              | (this server's own DB — same as `REGIONAL_DB_CONN_<REGION>`)               |
| `REGIONAL_DB_CONN_IND1`                         | `postgres://...@regional-db-ind1:5432/vetchium_ind1?sslmode=disable`       |
| `REGIONAL_DB_CONN_USA1`                         | `postgres://...@regional-db-usa1:5432/vetchium_usa1?sslmode=disable`       |
| `REGIONAL_DB_CONN_DEU1`                         | `postgres://...@regional-db-deu1:5432/vetchium_deu1?sslmode=disable`       |
| `S3_ENDPOINT_IND1`                              | `http://localstack-ind1:4566`                                              |
| `S3_ENDPOINT_USA1`                              | `http://localstack-usa1:4566`                                              |
| `S3_ENDPOINT_DEU1`                              | `http://localstack-deu1:4566`                                              |
| `S3_BUCKET_IND1`                                | `vetchium-ind1`                                                            |
| `S3_BUCKET_USA1`                                | `vetchium-usa1`                                                            |
| `S3_BUCKET_DEU1`                                | `vetchium-deu1`                                                            |
| `S3_REGION_IND1` / `_USA1` / `_DEU1`            | `us-east-1` (LocalStack ignores this in dev)                               |
| `S3_ACCESS_KEY_ID_IND1` / `_USA1` / `_DEU1`     | `vetchium-dev-key`                                                         |
| `S3_SECRET_ACCESS_KEY_IND1` / `_USA1` / `_DEU1` | `vetchium-dev-secret`                                                      |
| `GLOBAL_S3_ENDPOINT`                            | `http://localstack-ind1:4566` (pick ind1 to host the global bucket in dev) |
| `GLOBAL_S3_BUCKET`                              | `vetchium-global`                                                          |
| `GLOBAL_S3_REGION`                              | `us-east-1`                                                                |
| `GLOBAL_S3_ACCESS_KEY_ID`                       | `vetchium-dev-key`                                                         |
| `GLOBAL_S3_SECRET_ACCESS_KEY`                   | `vetchium-dev-secret`                                                      |

**Remove** these env vars from all regional API server blocks:

- `INTERNAL_ENDPOINT_IND1`, `INTERNAL_ENDPOINT_USA1`, `INTERNAL_ENDPOINT_DEU1`
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (the un-suffixed ones)

### 3.2 Global service

Same as regional API server **for the S3 globals only**:

- `GLOBAL_S3_ENDPOINT`, `GLOBAL_S3_BUCKET`, `GLOBAL_S3_REGION`, `GLOBAL_S3_ACCESS_KEY_ID`, `GLOBAL_S3_SECRET_ACCESS_KEY`

The global service still needs `IND1_DB_CONN`, `USA1_DB_CONN`, `DEU1_DB_CONN` for admin cross-region queries (unchanged). **Remove** `INTERNAL_ENDPOINT_*` and the un-suffixed `S3_*` vars.

### 3.3 Regional workers

Single-region; each worker only needs its own region's vars:

- `REGION`, `REGIONAL_DB_CONN`, optionally `S3_ENDPOINT_<REGION>` / `S3_BUCKET_<REGION>` / etc. **Remove** un-suffixed `S3_*`.

---

## 4. docker-compose changes (apply to all three files)

The three files are: `docker-compose-ci.json`, `docker-compose-backend.json`, `docker-compose-full.json`. They must all carry the same architecture; differences should be limited to timeouts, polling intervals, and whether UIs are included.

### 4.1 LocalStack: one instance per region

Replace the single `localstack` service with three:

```json
"localstack-ind1": {
  "image": "localstack/localstack",
  "environment": { "SERVICES": "s3", "DEBUG": "0" },
  "ports": ["4566:4566"],
  "healthcheck": {
    "test": ["CMD-SHELL", "curl -f http://localhost:4566/_localstack/health"],
    "interval": "5s", "timeout": "5s", "retries": 15
  }
},
"localstack-usa1": { ...same image..., "ports": ["4567:4566"], ... },
"localstack-deu1": { ...same image..., "ports": ["4568:4566"], ... }
```

### 4.2 S3 init: create per-region buckets + global bucket

Replace the single `s3-init` with one per region (plus a global bucket on the ind1 instance, since that's our designated global S3 host in dev):

```json
"s3-init-ind1": {
  "image": "amazon/aws-cli",
  "depends_on": { "localstack-ind1": { "condition": "service_healthy" } },
  "entrypoint": ["sh", "-c"],
  "command": [
    "i=0; until aws --endpoint-url=http://localstack-ind1:4566 s3 ls s3://vetchium-ind1 2>/dev/null || aws --endpoint-url=http://localstack-ind1:4566 s3 mb s3://vetchium-ind1 2>/dev/null; do i=$$((i+1)); [ $$i -ge 30 ] && exit 1; sleep 2; done && \
     until aws --endpoint-url=http://localstack-ind1:4566 s3 ls s3://vetchium-global 2>/dev/null || aws --endpoint-url=http://localstack-ind1:4566 s3 mb s3://vetchium-global 2>/dev/null; do i=$$((i+1)); [ $$i -ge 30 ] && exit 1; sleep 2; done"
  ],
  "environment": { "AWS_ACCESS_KEY_ID": "vetchium-dev-key", "AWS_SECRET_ACCESS_KEY": "vetchium-dev-secret", "AWS_DEFAULT_REGION": "us-east-1" }
},
"s3-init-usa1": { ...same shape, targets localstack-usa1, creates vetchium-usa1... },
"s3-init-deu1": { ...same shape, targets localstack-deu1, creates vetchium-deu1... }
```

### 4.3 Regional API server blocks

For each of `regional-api-server-ind1`, `regional-api-server-usa1`, `regional-api-server-deu1`:

- **Remove** from `environment`: `INTERNAL_ENDPOINT_IND1/USA1/DEU1`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- **Ensure present**: `REGIONAL_DB_CONN_IND1`, `REGIONAL_DB_CONN_USA1`, `REGIONAL_DB_CONN_DEU1` (currently only in `docker-compose-ci.json`; add to `backend.json` and `full.json`).
- **Add** all the `S3_*_<REGION>` and `GLOBAL_S3_*` env vars from §3.1.
- **depends_on**: add `s3-init-ind1`, `s3-init-usa1`, `s3-init-deu1` (each `service_completed_successfully`). Drop the old `s3-init` entry.

### 4.4 Global service block

- **Remove** `INTERNAL_ENDPOINT_*`, un-suffixed `S3_*`.
- **Add** the `GLOBAL_S3_*` env vars.
- **depends_on**: replace `s3-init` with `s3-init-ind1`.

### 4.5 Regional worker blocks

- Each worker only depends on its own region's `s3-init-<region>` (and only if the worker uses S3 — confirm via grep before adding).

### 4.6 api-lb (nginx) — no changes needed

The load balancer still round-robins across all regional API servers. That stays. Option A explicitly relies on the LB not having session affinity (§5).

---

## 5. Test impact

Most playwright tests run through the LB; they do not target a specific region. They should continue to pass without modification — provided the cross-region DB and S3 wiring works.

Two specific checks the implementing AI should run after the migration:

1. **Cross-region hub login.** Sign up a hub user against the LB; force a known home region; then log in repeatedly through the LB and confirm 100% success rate. Today this can fail under Option E if the proxy loop ever materialises; under Option A it should be deterministic.
2. **Cross-region profile picture upload.** Confirm the file lands in the user's home region's bucket (use `aws --endpoint-url=http://localhost:<port> s3 ls s3://vetchium-<region>/profiles/`).

If tests fail, fix the migration, not the tests. The tests assert the user-visible contract; if the contract regresses under Option A the implementation is wrong.

---

## 6. Out of scope (do not touch)

- `admin_audit_logs` PII handling vs. ADR C1 — this is a known gap; a future ADR addendum will address it. Do **not** move audit tables or add redaction in this PR.
- Step 1 lint rule from ADR §10 (`//nolint:crossregion` marker). Not required yet.
- pgBouncer deployment (§9 risk register). Out of scope until connection counts demand it.
- Distributed SQL migration (Option C). Long-term only.

---

## 7. Acceptance checklist

The work is done when **all** of these are true:

- [ ] `grep -rn "internal/proxy\|ProxyToRegion\|proxy.BufferBody\|proxy.ToRegion\|InternalEndpoints\|INTERNAL_ENDPOINT_" api-server/` returns zero matches.
- [ ] `api-server/internal/proxy/` directory no longer exists.
- [ ] `cd api-server && sqlc generate && go build ./... && go vet ./...` succeeds.
- [ ] `goimports -w` leaves no diff.
- [ ] All three docker-compose files start cleanly: `docker compose -f docker-compose-ci.json up --build -d` reaches `service_healthy` for all four DBs, all three localstacks, all three regional API servers, the global service, and api-lb. Repeat for `-backend.json` and `-full.json`.
- [ ] No env var matching `S3_ENDPOINT$`, `S3_BUCKET$`, `S3_REGION$`, `S3_ACCESS_KEY_ID$`, `S3_SECRET_ACCESS_KEY$`, or `INTERNAL_ENDPOINT_*` remains in any of the three compose files.
- [ ] Playwright suite (`cd playwright && npm test`) passes against `docker-compose-ci.json`.
- [ ] ADR §1.1 reflects per-region S3; ADR §1.4 (new) describes regional object storage; fig1-topology.svg arrows from API servers (not Regional DBs) to Global DB; fig1 legend mentions per-region buckets.
- [ ] Manual smoke test: sign up a hub user, log in from a different region (i.e., the LB happens to route the login request to a non-home server), upload a profile picture, log out, log back in. All succeed; bucket `vetchium-<home_region>` contains the picture.

---

## 8. If you get stuck

Stop and report. Do not invent a workaround. Specific red flags:

- A handler appears to need data from two different regional DBs in the same write transaction — that's a cross-region distributed transaction, which ADR explicitly does not solve. Surface it.
- An endpoint cannot be made stateless w.r.t. region (e.g., relies on the request landing on the home region for some reason other than DB access) — surface it; the design assumes no such endpoint exists.
- A test fails because it depended on the proxy behaviour (e.g., asserted certain headers were rewritten) — fix the test if the assertion is no longer meaningful; surface it if you're unsure.
