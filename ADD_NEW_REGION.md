# Adding a New Region to Vetchium

## Architecture Overview

A **region** in Vetchium is a named geographic deployment zone. Each region runs its own independent Regional DB, Regional API server, and Regional Worker. User data is stored in the region chosen at signup; SubOrg data is stored in the SubOrg's pinned region.

### The Region Registry

The `available_regions` table in the Global DB is the single source of truth:

```sql
CREATE TABLE available_regions (
    region_code region PRIMARY KEY,   -- PostgreSQL ENUM value
    region_name TEXT NOT NULL,        -- human-readable display label
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
```

| Code   | Name                | Active |
|--------|---------------------|--------|
| `ind1` | India - Chennai     | Yes    |
| `usa1` | USA - California    | Yes    |
| `deu1` | Germany - Frankfurt | Yes    |
| `sgp1` | Singapore           | No     |

`sgp1` is provisioned but `is_active = FALSE` — it is invisible to users until activated. This is the standard staging pattern for new regions.

### Rules

- **All UI portals** that display a region picker must call `POST /global/get-regions` and render the result dynamically. Hardcoding region codes in UI components is a bug.
- **All request handlers** that accept a user-supplied region code must validate it by querying `available_regions WHERE is_active = TRUE`. Hardcoding valid region codes in TypeSpec validators or handler code is a bug.
- The `POST /global/get-regions` endpoint is unauthenticated and returns only active regions, sorted alphabetically by `region_name`.
- `is_active = FALSE` immediately hides a region from all UIs and causes all handlers to reject it — no code deployment or restart required.
- Region codes are **immutable** once created. A user cannot change their home region after signup.

---

## Runbook: Adding a New Region

The example below adds `fra1` (France - Paris). Substitute accordingly.

### Phase 1 — Infrastructure

1. Provision a new PostgreSQL instance for the regional DB (`vetchium_fra1`).
2. Provision a host/container for the Regional API server and Regional Worker.
3. Run the regional schema migration against the new instance:
   ```bash
   goose -dir api-server/db/migrations/regional postgres "<fra1-dsn>" up
   ```
4. Update `docker-compose-full.json` and `docker-compose-ci.json` — add:
   - `regional-db-fra1` service
   - `regional-api-server-fra1` service with `REGION=fra1`
   - `regional-worker-fra1` service
5. Update `nginx/api-lb.conf` to route `fra1` session tokens to `regional-api-server-fra1`.

### Phase 2 — Global DB Schema

6. Add the new code to the PostgreSQL `region` ENUM in
   `api-server/db/migrations/global/00000000000001_initial_schema.sql`:
   ```sql
   ALTER TYPE region ADD VALUE 'fra1';
   ```
   > **Note**: PostgreSQL ENUM additions are non-transactional and cannot be rolled back. Run in a maintenance window.

7. Insert the region into the registry — **inactive** for staging:
   ```sql
   INSERT INTO available_regions (region_code, region_name, is_active)
   VALUES ('fra1', 'France - Paris', FALSE);
   ```

### Phase 3 — Code Changes

8. Add the Go constant in `api-server/internal/db/globaldb/models.go`:
   ```go
   RegionFra1 Region = "fra1"
   ```

9. Add the routing entry in `api-server/cmd/regional-api-server/main.go`:
   ```go
   globaldb.RegionFra1: "http://regional-api-server-fra1:8080",
   ```
   Without this the global API server cannot route requests to the new region.

10. Add the test DB port mapping in `playwright/lib/db.ts`:
    ```typescript
    fra1: 5436,  // next available port
    ```

11. Build and deploy the updated binaries (global API server, new regional API server and worker).

### Phase 4 — Activation

12. Once smoke-tested, flip the go-live switch:
    ```sql
    UPDATE available_regions SET is_active = TRUE WHERE region_code = 'fra1';
    ```
    The region immediately appears in `POST /global/get-regions` responses and is accepted by all handlers. No restart needed.

### Phase 5 — Verification

13. Call `POST /global/get-regions` — confirm `fra1` appears.
14. Run the full Playwright test suite — confirm no regressions.
15. Attempt a signup and a SubOrg creation targeting `fra1` — confirm both succeed.

### Rollback

Set `is_active = FALSE` to immediately hide the region from all UIs and reject new requests. Existing data in the `fra1` regional DB is unaffected. Reverse the Phase 3 code changes and redeploy if the infrastructure is to be decommissioned.
