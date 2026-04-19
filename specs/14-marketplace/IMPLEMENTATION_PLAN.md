# Implementation Plan — Marketplace v2 + Org Tiers

Scope: `specs/14-marketplace/SPEC.md` + `specs/16-org-tiers/SPEC.md`.
Target executor: Sonnet 4.7. Follow steps in order; keep diffs tight.

## Decisions (already made — do NOT re-litigate)

1. **No invoicing** (`specs/15-invoicing/`) — out of scope. Any spec reference to invoices becomes a UI TODO (plain text link placeholder) or is silently omitted. Do not create an `invoices` table.
2. **Delete and rewrite marketplace cleanly.** The existing marketplace code was written for single-capability-per-listing + per-listing billing + `listing_id` URLs. All of that is obsolete. Wipe it and rebuild from spec.
3. **Dedicated columns for tier quotas** (not JSONB). Rationale: type-safe, sqlc-friendly, easy to extend later.
4. **Tier changes**: Orgs self-upgrade via the org portal (no payment integration — the upgrade just flips the tier). Admins handle downgrade, grant-for-free, suspend, force-downgrade via the admin portal. **No billing-period records, no `past_due`/`frozen` states in V1.** The `OrgSubscription` table holds only `current_tier_id` + `updated_at` + `updated_by` + `note`.
5. **Do NOT enforce quotas for features not yet built** (Openings, Org Posts/Streams, audit retention). Enforce only the quotas the platform already has primitives for: Org Users, Domains, SubOrgs, Marketplace Listings.

## Order of execution

Phase 0 → 1 → 2 → 3 → 4. Do not interleave. Commit between phases.

---

## Phase 0 — Delete obsolete marketplace code

Delete every file below. Do NOT edit them first.

**API server**

- `api-server/handlers/org/marketplace-capabilities.go`
- `api-server/handlers/org/marketplace-clients.go`
- `api-server/handlers/org/marketplace-discover.go`
- `api-server/handlers/org/marketplace-helpers.go`
- `api-server/handlers/org/marketplace-listings.go`
- `api-server/handlers/org/marketplace-subscriptions.go`
- `api-server/handlers/admin/marketplace-capabilities.go`
- `api-server/handlers/admin/marketplace-helpers.go`
- `api-server/handlers/admin/marketplace-listings.go`
- `api-server/handlers/admin/marketplace-subscriptions.go`

**Frontend**

- `org-ui/src/pages/Marketplace/` (whole dir)
- `admin-ui/src/pages/Marketplace/` (whole dir)

**TypeSpec** (will be rewritten in Phase 2)

- `specs/typespec/org/marketplace.{tsp,ts,go}`
- `specs/typespec/admin/marketplace.{tsp,ts,go}`

**Playwright tests**

- `playwright/tests/api/org/marketplace.spec.ts`
- `playwright/tests/api/admin/marketplace.spec.ts`
- `playwright/tests/ui/org/marketplace.spec.ts` — delete whole file; new UI tests written in Phase 2.9.

**Playwright helper libraries — strip marketplace sections in place (do not delete the files)**

- `playwright/lib/admin-api-client.ts` (~28 marketplace refs): remove all `marketplace*` methods (capability CRUD, listings, subscriptions, billing) — V1 shapes are wrong for V2 and will be re-added in Phase 2.
- `playwright/lib/org-api-client.ts` (~48 refs): remove every `marketplace*` method (capabilities, listings, subscriptions, discover, clients).
- `playwright/lib/db.ts` (~17 refs): remove
  - The `DELETE FROM marketplace_subscriptions` / `marketplace_listings` / `marketplace_billing_records` / `marketplace_subscription_index` / `marketplace_listing_catalog` cleanup SQL in the `deleteTestOrg*` helpers (re-added in Phase 2 once new schemas land).
  - `createTestMarketplaceCapability`, `deleteTestMarketplaceCapability`, and any other marketplace helpers. Any comment block labelled "Marketplace Test Helpers".

Any test file that imports the deleted helpers/methods should already be in the delete list above. If the compiler flags a stray import, remove it.

**Migrations — remove marketplace sections in place (do not delete the files)**

- In `api-server/db/migrations/global/00000000000001_initial_schema.sql`: delete everything under the `-- Marketplace: ...` sections (capabilities, capability_translations, listing_catalog, subscription_index, billing_records, their indexes, and the staffing seed INSERTs). Keep the admin role seeds for `admin:view_marketplace` / `admin:manage_marketplace` (they will be reused).
- In `api-server/db/migrations/regional/00000000000001_initial_schema.sql`: delete everything under `-- Marketplace: ...` sections (listing_status ENUM, subscription_status ENUM, marketplace_listings, marketplace_subscriptions, their indexes). Keep org role seeds for `org:view_listings`, `org:manage_listings`, `org:view_subscriptions`, `org:manage_subscriptions`.

**sqlc queries — remove marketplace sections**

- `api-server/db/queries/global.sql`: delete `-- Marketplace: capability catalog (global)` block and any related queries (lines ~882 onward through end of marketplace block).
- `api-server/db/queries/regional.sql`: delete `-- Marketplace: listings` and `-- Marketplace: subscriptions` blocks.

**App.tsx route registrations**

- `org-ui/src/App.tsx`: remove the 8 marketplace imports and every `<Route path="/marketplace/...">` JSX block, plus the `MarketplaceListingsRoute` / `MarketplaceSubscriptionsRoute` helper components. Also remove the `MarketplaceListingsTile`/`MarketplaceDiscoverTile`/`MarketplaceSubscriptionsTile`/`MarketplaceClientsTile` from the dashboard (leave placeholders only if they rely on state you need — they don't).
- `admin-ui/src/App.tsx`: remove marketplace imports and routes (including `BillingPage`).

**Admin-ui i18n**

- Delete marketplace-scoped i18n files. Keep only the keys that will be reused in Phase 2 (you can just rewrite from scratch in Phase 2 — easier than merging).

**DashboardPage tiles**

- `org-ui/src/pages/DashboardPage.tsx`: remove marketplace tiles.
- `admin-ui/src/pages/DashboardPage.tsx`: remove marketplace tiles.

**Regenerate after deletion**

```bash
cd api-server && sqlc generate && go build ./...
cd specs/typespec && bun install && tsp compile .
```

Fix any residual compile errors by removing the leftover references. Do NOT invent stubs.

**Commit**: `refactor: delete obsolete marketplace v1 code`

---

## Phase 1 — Org Tiers

### 1.1 Roles — add to schema + TypeSpec

**`api-server/db/migrations/global/00000000000001_initial_schema.sql`** — in the admin roles INSERT block, add:

```sql
('admin:view_org_subscriptions', 'Can view org tier subscriptions (read-only)'),
('admin:manage_org_subscriptions', 'Can grant tiers, waive fees, suspend, and force-downgrade'),
```

**`api-server/db/migrations/regional/00000000000001_initial_schema.sql`** — in the org roles INSERT block, add:

```sql
('org:view_subscription', 'Can view own org tier subscription and usage (read-only)'),
('org:manage_subscription', 'Can upgrade own org tier subscription'),
```

**`specs/typespec/common/roles.ts`**: add the four names to `VALID_ROLE_NAMES`.
**`specs/typespec/common/roles.go`**: mirror the same four names in the Go `validRoleNames` list.

### 1.2 Tier catalog — static, code-seeded

Four tiers: `free`, `silver`, `gold`, `enterprise`. Keep the catalog in **global DB** so it can be read uniformly.

**Global schema addition** (in the global initial_schema.sql, new section `-- Org Tiers`):

```sql
CREATE TABLE org_tiers (
    tier_id                        TEXT        PRIMARY KEY,  -- 'free','silver','gold','enterprise'
    display_order                  INT         NOT NULL UNIQUE,
    -- Quota caps. NULL means unlimited.
    org_users_cap                  INT,
    domains_verified_cap           INT,
    suborgs_cap                    INT,
    marketplace_listings_cap       INT,        -- 0 for free (cannot publish)
    audit_retention_days           INT,
    -- Marker: is this tier user-selectable via self-upgrade?
    self_upgradeable               BOOLEAN     NOT NULL DEFAULT FALSE,
    status                         TEXT        NOT NULL CHECK (status IN ('active','retired')) DEFAULT 'active',
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE org_tier_translations (
    tier_id                        TEXT        NOT NULL REFERENCES org_tiers(tier_id),
    locale                         TEXT        NOT NULL,
    display_name                   TEXT        NOT NULL,
    description                    TEXT        NOT NULL DEFAULT '',
    PRIMARY KEY (tier_id, locale)
);

-- Seed the four tiers. Prices are omitted (no billing in V1).
INSERT INTO org_tiers (tier_id, display_order, org_users_cap, domains_verified_cap, suborgs_cap, marketplace_listings_cap, audit_retention_days, self_upgradeable, status) VALUES
    ('free',       1, 5,    2,    0,  0,  30,  FALSE, 'active'),
    ('silver',     2, 25,   5,    3,  5,  365, TRUE,  'active'),
    ('gold',       3, 100,  NULL, 10, 20, 1095,TRUE,  'active'),
    ('enterprise', 4, NULL, NULL, NULL, NULL, NULL, FALSE, 'active');

INSERT INTO org_tier_translations (tier_id, locale, display_name, description) VALUES
    ('free',       'en-US', 'Free',       'Free tier. Discover and consume marketplace. No publishing.'),
    ('silver',     'en-US', 'Silver',     'For orgs running hiring + modest marketplace listings.'),
    ('gold',       'en-US', 'Gold',       'For heavy operators — staffing firms, multi-site employers.'),
    ('enterprise', 'en-US', 'Enterprise', 'Custom commercial terms. Contact us.');
-- Add de-DE and ta-IN translations (short)
INSERT INTO org_tier_translations (tier_id, locale, display_name, description) VALUES
    ('free', 'de-DE', 'Kostenlos', ''),
    ('silver', 'de-DE', 'Silber', ''),
    ('gold', 'de-DE', 'Gold', ''),
    ('enterprise', 'de-DE', 'Enterprise', ''),
    ('free', 'ta-IN', 'இலவசம்', ''),
    ('silver', 'ta-IN', 'வெள்ளி', ''),
    ('gold', 'ta-IN', 'தங்கம்', ''),
    ('enterprise', 'ta-IN', 'நிறுவனம்', '');
```

### 1.3 OrgSubscription — one row per org

**Global schema addition**:

```sql
CREATE TABLE org_subscriptions (
    org_id                    UUID         PRIMARY KEY REFERENCES orgs(org_id),
    current_tier_id           TEXT         NOT NULL REFERENCES org_tiers(tier_id),
    updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_by_admin_id       UUID,                       -- if admin-set
    updated_by_org_user_id    UUID,                       -- if org-set (self-upgrade)
    note                      TEXT         NOT NULL DEFAULT ''
);

CREATE TABLE org_subscription_history (
    history_id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                    UUID         NOT NULL,
    from_tier_id              TEXT,                       -- NULL for initial assignment
    to_tier_id                TEXT         NOT NULL,
    changed_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    changed_by_admin_id       UUID,
    changed_by_org_user_id    UUID,
    reason                    TEXT         NOT NULL DEFAULT ''
);
```

**Initialization**: when `complete-signup` creates a new org (look for the `CreateOrg`/`InsertOrg` insertion site in `handlers/org/complete-signup.go`), in the same global tx insert an `org_subscriptions` row with `current_tier_id='free'` and write the corresponding `org_subscription_history` row with `from_tier_id=NULL`, `to_tier_id='free'`, `reason='signup'`.

### 1.4 sqlc queries

Add to `api-server/db/queries/global.sql` under a new `-- Org Tiers` section:

```sql
-- name: ListOrgTiers :many
-- Returns active tiers in display order with en-US names for the default fallback
SELECT t.*, COALESCE(tr.display_name, t.tier_id) AS display_name, COALESCE(tr.description, '') AS description
FROM org_tiers t
LEFT JOIN org_tier_translations tr ON t.tier_id = tr.tier_id AND tr.locale = @locale::text
WHERE t.status = 'active'
ORDER BY t.display_order;

-- name: GetOrgTier :one
SELECT * FROM org_tiers WHERE tier_id = @tier_id;

-- name: GetOrgSubscription :one
SELECT s.*, t.*
FROM org_subscriptions s
JOIN org_tiers t ON s.current_tier_id = t.tier_id
WHERE s.org_id = @org_id;

-- name: CreateOrgSubscription :exec
INSERT INTO org_subscriptions (org_id, current_tier_id, updated_by_admin_id, updated_by_org_user_id, note)
VALUES (@org_id, @current_tier_id, @updated_by_admin_id, @updated_by_org_user_id, @note);

-- name: UpdateOrgSubscriptionTier :exec
UPDATE org_subscriptions
SET current_tier_id = @current_tier_id, updated_at = NOW(),
    updated_by_admin_id = @updated_by_admin_id, updated_by_org_user_id = @updated_by_org_user_id, note = @note
WHERE org_id = @org_id;

-- name: InsertOrgSubscriptionHistory :exec
INSERT INTO org_subscription_history (org_id, from_tier_id, to_tier_id, changed_by_admin_id, changed_by_org_user_id, reason)
VALUES (@org_id, @from_tier_id, @to_tier_id, @changed_by_admin_id, @changed_by_org_user_id, @reason);

-- name: AdminListOrgSubscriptions :many
SELECT s.*, t.tier_id AS tier_key, o.domain_name
FROM org_subscriptions s
JOIN org_tiers t ON s.current_tier_id = t.tier_id
JOIN orgs o ON s.org_id = o.org_id
WHERE (sqlc.narg('filter_tier_id')::text IS NULL OR s.current_tier_id = sqlc.narg('filter_tier_id')::text)
  AND (sqlc.narg('pagination_key')::uuid IS NULL OR s.org_id > sqlc.narg('pagination_key')::uuid)
ORDER BY s.org_id ASC
LIMIT @row_limit;
```

Add usage-counting helpers (some may already exist — reuse where possible):

```sql
-- name: CountOrgUsers :one
SELECT COUNT(*)::int FROM org_users WHERE org_id = @org_id;

-- name: CountVerifiedDomainsForOrg :one
-- org_domains is global and has status column — tweak if your schema differs
SELECT COUNT(*)::int FROM org_domains WHERE org_id = @org_id AND status = 'verified';

-- name: CountSubOrgsForOrg :one  (regional)
-- Add in regional.sql
SELECT COUNT(*)::int FROM suborgs WHERE org_id = @org_id;
```

### 1.5 TypeSpec types

Create `specs/typespec/org/tiers.tsp` (`.tsp`, `.ts`, `.go`):

Types:

- `OrgTier { tier_id: string; display_name: string; description: string; display_order: int32; org_users_cap?: int32; domains_verified_cap?: int32; suborgs_cap?: int32; marketplace_listings_cap?: int32; audit_retention_days?: int32; self_upgradeable: boolean; }` — null means unlimited; omit the prop.
- `OrgTierUsage { org_users: int32; domains_verified: int32; suborgs: int32; marketplace_listings: int32; }`
- `OrgSubscription { org_id: string; org_domain: string; current_tier: OrgTier; usage: OrgTierUsage; updated_at: string; note: string; }`
- Requests: `ListOrgTiersRequest{}`, `ListOrgTiersResponse{ tiers: OrgTier[] }`, `GetMyOrgSubscriptionRequest{}` (returns `OrgSubscription`), `SelfUpgradeOrgSubscriptionRequest{ tier_id: string }`, `AdminListOrgSubscriptionsRequest{ filter_tier_id?: string; pagination_key?: string; limit?: int32 }`, `AdminListOrgSubscriptionsResponse{ items: OrgSubscription[]; next_pagination_key?: string }`, `AdminSetOrgTierRequest{ org_id: string; tier_id: string; reason: string }`.

Create `specs/typespec/admin/org-subscriptions.tsp` for the admin-side routes or fold them into the same file — pick org/tiers.tsp as single source and put both routes there (keep one namespace).

Routes:

- `POST /org/org-subscriptions/list-tiers` — any authenticated org user → `ListOrgTiersResponse`.
- `POST /org/org-subscriptions/get` — `org:view_subscription` or `org:manage_subscription` or `org:superadmin` → `OrgSubscription`.
- `POST /org/org-subscriptions/self-upgrade` — `org:manage_subscription` or `org:superadmin` → `OrgSubscription`. Rejects with 422 if `tier.self_upgradeable = false` or if the org already has that tier or higher display_order.
- `POST /admin/org-subscriptions/list` — `admin:view_org_subscriptions` or manage → `AdminListOrgSubscriptionsResponse`.
- `POST /admin/org-subscriptions/set-tier` — `admin:manage_org_subscriptions` → `OrgSubscription`. No self-upgradeable check here; admin can set any tier including `enterprise`.

Validation: `tier_id` must match one of the known tier ids; `reason` 0–2000 chars; pagination limit default 20 max 100.

### 1.6 Handlers

**Create files**:

- `api-server/handlers/org/org-subscription-list-tiers.go`
- `api-server/handlers/org/org-subscription-get.go`
- `api-server/handlers/org/org-subscription-self-upgrade.go`
- `api-server/handlers/admin/org-subscription-list.go`
- `api-server/handlers/admin/org-subscription-set-tier.go`

**Shared helper** — `api-server/internal/orgtiers/orgtiers.go`:

```go
package orgtiers

// QuotaCheck is called before a write that would bump a usage counter.
// Returns (allowed, currentCount, cap). cap == -1 means unlimited.
type QuotaKey string
const (
    QuotaOrgUsers           QuotaKey = "org_users"
    QuotaDomainsVerified    QuotaKey = "domains_verified"
    QuotaSubOrgs            QuotaKey = "suborgs"
    QuotaMarketplaceListings QuotaKey = "marketplace_listings"
)

// EnforceQuota returns nil if allowed, ErrQuotaExceeded (with QuotaKey+tier) otherwise.
// Implementation: look up org's tier from org_subscriptions, fetch the cap column,
// count current usage, compare. Use the appropriate DB (global for org_users/domains,
// regional for suborgs/listings).
```

Define `server.ErrQuotaExceeded` (new sentinel error) and handle in callers as 403 with body `{"quota": "marketplace_listings", "current_cap": 5, "tier_id": "silver"}` so the UI can show the upgrade modal.

**Self-upgrade logic** (`org-subscription-self-upgrade.go`):

1. Decode + validate request.
2. `OrgUserFromContext(ctx)`; require `org:manage_subscription` or `org:superadmin` (middleware handles role); extract `org_id`.
3. `s.WithGlobalTx`:
   - `GetOrgSubscription(org_id)` → current tier.
   - `GetOrgTier(tier_id)` → target tier; reject 422 if not self_upgradeable, if equal, or if `display_order < current.display_order`.
   - `UpdateOrgSubscriptionTier`.
   - `InsertOrgSubscriptionHistory`.
   - `InsertAuditLog` with `event_type='org.subscription_tier_upgraded'`, `event_data={"from":..., "to":..., "org_id":...}`.
4. Respond with fresh `OrgSubscription`.

**Admin set-tier**: similar but audit event `admin.org_subscription_granted`, goes to `admin_audit_logs`. No self_upgradeable check; allow any tier including Free (downgrade). Reject 422 if downgrade and any enforced usage > target cap — the API returns 409 with the blocking usage map so the admin UI can display it.

### 1.7 Quota enforcement at write sites

In the existing handlers below, add a call to `orgtiers.EnforceQuota(...)` _inside the existing tx_, right before the INSERT. On `ErrQuotaExceeded` return 403 with the JSON payload shape above.

- `handlers/org/invite-user.go` — `QuotaOrgUsers`. (The org-user invite likely inserts a new row; count with `CountOrgUsers` BEFORE the insert.)
- `handlers/org/claim-domain.go` — `QuotaDomainsVerified`. (But only bump when the domain is _verified_, not claimed. So enforce inside `handlers/org/verify-domain.go` instead, right before the status→verified update.)
- `handlers/org/suborgs.go` create-suborg path — `QuotaSubOrgs`.
- Phase-2 marketplace create-listing — `QuotaMarketplaceListings` (deferred to Phase 2).

Do not refactor; insert minimal code.

### 1.8 Frontend — org portal `/settings/subscription`

Create `org-ui/src/pages/Subscription/SubscriptionPage.tsx`:

- Standard feature-page layout (see CLAUDE.md §"Page Layout Standard").
- Back-to-dashboard button.
- Title: `Subscription`.
- **Current tier card**: name + description + list of quota caps.
- **Usage vs quota table**: 4 rows (Org Users, Domains, SubOrgs, Listings) with current/cap.
- **Compare plans**: list all 4 tiers side-by-side with caps. Show **Upgrade to X** button on each tier that is `self_upgradeable` AND has higher `display_order` than current.
- **Enterprise card**: "Contact us" — no button.
- On click Upgrade, show Ant Design `Modal.confirm` with the diff, then call `/org/org-subscriptions/self-upgrade`.
- After success, toast + refetch.

Add a `useMyOrgSubscription` hook under `org-ui/src/hooks/` (fetch once, cache with React Query if used — otherwise simple useState+useEffect matching existing patterns).

**Dashboard tile**: add `Subscription` tile on `DashboardPage.tsx` that routes to `/settings/subscription`. Visible to any user with `org:view_subscription` or `org:manage_subscription` or `org:superadmin`.

**Quota-exceeded modal**: create `org-ui/src/components/QuotaExceededModal.tsx`. Reusable, takes a 403 body `{quota, current_cap, tier_id}`, shows a message and a button linking to `/settings/subscription`. Wire it into the fetch handlers for invite-user, verify-domain, create-suborg, create-listing (Phase 2).

### 1.9 Frontend — admin portal `/admin/org-subscriptions`

Create `admin-ui/src/pages/OrgSubscriptions/OrgSubscriptionsPage.tsx`:

- Feature-page layout, title "Org Subscriptions".
- Table of orgs: domain, current tier, last-updated-at, last-updater (org vs admin).
- Filter: tier dropdown.
- Keyset pagination.
- Row action: **Change tier** → opens modal with tier dropdown + `reason` textarea (required, max 2000 chars) → calls `/admin/org-subscriptions/set-tier`.
- Downgrade-blocked response (409): show the blocking-usage table in the modal.

**Dashboard tile**: `Org Subscriptions` on admin-ui DashboardPage, visible to `admin:view_org_subscriptions` / `admin:manage_org_subscriptions` / `admin:superadmin`.

### 1.10 i18n

Add keys in `en-US`, `de-DE`, `ta-IN` for both new pages. Keep strings minimal.

### 1.11 Playwright tests

Create `playwright/tests/api/org/org-subscription.spec.ts`:

- On signup → org has `free` tier (assert via GET).
- Self-upgrade to `silver` as superadmin → 200, returns updated subscription.
- Self-upgrade to `silver` as `org:manage_subscription` (no superadmin) → 200.
- Self-upgrade to `enterprise` → 422 (not self-upgradeable).
- Self-upgrade to `free` (downgrade) → 422.
- Self-upgrade without `org:manage_subscription` role → 403.
- Audit log written on success; no audit log on failure.

Create `playwright/tests/api/admin/org-subscription.spec.ts`:

- Admin list orgs → paginated, filterable.
- Admin set-tier `free → gold` → 200.
- Admin downgrade when over cap → 409 with blocking usage payload.
- RBAC positive/negative (same pattern as other admin endpoints).

Quota-enforcement tests go in _the existing_ feature spec files for invite-user / verify-domain / create-suborg — add a test that drives each to its cap and asserts 403 with the quota payload. Restore by deleting the over-cap resources in `afterAll`.

**Commit**: `feat: org tiers (free/silver/gold/enterprise) with self-upgrade + admin management`

---

## Phase 2 — Marketplace v2

### 2.1 Schema — Global DB

In `api-server/db/migrations/global/00000000000001_initial_schema.sql`, add under a new `-- Marketplace` section (the old section was deleted in Phase 0):

```sql
CREATE TABLE marketplace_capabilities (
    capability_id TEXT        PRIMARY KEY CHECK (capability_id ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
    status        TEXT        NOT NULL CHECK (status IN ('draft','active','disabled')) DEFAULT 'draft',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE marketplace_capability_translations (
    capability_id TEXT NOT NULL REFERENCES marketplace_capabilities(capability_id),
    locale        TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (capability_id, locale)
);

-- Global mirror of active listings (for cross-region discovery)
CREATE TABLE marketplace_listing_catalog (
    listing_id          UUID        PRIMARY KEY,
    org_id              UUID        NOT NULL REFERENCES orgs(org_id),
    org_domain          TEXT        NOT NULL,
    listing_number      INT         NOT NULL,
    headline            TEXT        NOT NULL,
    description         TEXT        NOT NULL,
    capability_ids      TEXT[]      NOT NULL,
    listed_at           TIMESTAMPTZ NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL,
    UNIQUE (org_domain, listing_number)
);
CREATE INDEX idx_marketplace_listing_catalog_capability ON marketplace_listing_catalog USING GIN (capability_ids);

-- Global subscription index (routing for provider cross-region client view)
CREATE TABLE marketplace_subscription_index (
    subscription_id        UUID        PRIMARY KEY,
    listing_id             UUID        NOT NULL,
    consumer_org_id        UUID        NOT NULL REFERENCES orgs(org_id),
    consumer_region        TEXT        NOT NULL,
    provider_org_id        UUID        NOT NULL REFERENCES orgs(org_id),
    provider_region        TEXT        NOT NULL,
    status                 TEXT        NOT NULL,
    updated_at             TIMESTAMPTZ NOT NULL,
    UNIQUE (consumer_org_id, listing_id)
);

-- Seed a sample capability so discovery isn't empty
INSERT INTO marketplace_capabilities (capability_id, status) VALUES ('staffing', 'active');
INSERT INTO marketplace_capability_translations VALUES
    ('staffing', 'en-US', 'Staffing', 'Recruitment and staffing services'),
    ('staffing', 'de-DE', 'Personalvermittlung', ''),
    ('staffing', 'ta-IN', 'பணியாளர் சேர்க்கை', '');
```

### 2.2 Schema — Regional DB

```sql
CREATE TYPE marketplace_listing_status AS ENUM ('draft','pending_review','active','suspended','archived');
CREATE TYPE marketplace_subscription_status AS ENUM ('active','cancelled','expired');

-- Per-org atomic listing number counter
CREATE TABLE org_marketplace_listing_counters (
    org_id            UUID NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE PRIMARY KEY,
    last_listing_number INT NOT NULL DEFAULT 0
);

CREATE TABLE marketplace_listings (
    listing_id        UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES orgs(org_id),
    org_domain        TEXT NOT NULL,
    listing_number    INT  NOT NULL,
    headline          TEXT NOT NULL CHECK (char_length(headline) <= 100),
    description       TEXT NOT NULL CHECK (char_length(description) <= 10000),
    status            marketplace_listing_status NOT NULL DEFAULT 'draft',
    suspension_note   TEXT,
    rejection_note    TEXT,
    listed_at         TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, listing_number)
);

CREATE TABLE marketplace_listing_capabilities (
    listing_id      UUID NOT NULL REFERENCES marketplace_listings(listing_id) ON DELETE CASCADE,
    capability_id   TEXT NOT NULL,  -- loose FK (global) — validate in app
    added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    removed_at      TIMESTAMPTZ,
    PRIMARY KEY (listing_id, capability_id)
);
CREATE INDEX idx_marketplace_listings_org ON marketplace_listings(org_id, status, updated_at DESC);

CREATE TABLE marketplace_subscriptions (
    subscription_id           UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id                UUID NOT NULL,
    consumer_org_id           UUID NOT NULL REFERENCES orgs(org_id),
    consumer_org_domain       TEXT NOT NULL,
    provider_org_id           UUID NOT NULL,
    provider_org_domain       TEXT NOT NULL,
    provider_listing_number   INT  NOT NULL,
    request_note              TEXT NOT NULL DEFAULT '' CHECK (char_length(request_note) <= 2000),
    status                    marketplace_subscription_status NOT NULL DEFAULT 'active',
    started_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at                TIMESTAMPTZ,
    cancelled_at              TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (consumer_org_id, listing_id)
);
CREATE INDEX idx_marketplace_subscriptions_consumer ON marketplace_subscriptions(consumer_org_id, status, updated_at DESC);
```

### 2.3 sqlc queries

**global.sql** (new section `-- Marketplace`):

- `CreateCapability`, `UpdateCapabilityStatus`, `UpsertCapabilityTranslation`, `GetCapability` (with translation join), `ListActiveCapabilities` (with translation fallback to en-US), `ListAllCapabilities` (admin).
- `UpsertListingCatalog`, `DeleteListingCatalog`, `ListListingCatalogByCapability` (keyset paginated, GIN), `GetListingCatalogByDomainAndNumber`, `FullTextSearchListingCatalog` (basic `headline ILIKE` + `description ILIKE`; do not introduce pg_trgm in V1).
- `UpsertSubscriptionIndex`, `UpdateSubscriptionIndexStatus`, `ListSubscriptionsForProvider` (by `provider_org_id`, keyset).

**regional.sql** (new section `-- Marketplace`):

- `NextListingNumberForOrg`:
  ```sql
  -- name: NextListingNumberForOrg :one
  INSERT INTO org_marketplace_listing_counters (org_id, last_listing_number)
  VALUES (@org_id, 1)
  ON CONFLICT (org_id) DO UPDATE SET last_listing_number = org_marketplace_listing_counters.last_listing_number + 1
  RETURNING last_listing_number;
  ```
- CRUD on `marketplace_listings` (create, get by id, get by (org_id, listing_number), list-by-org paginated with status filter, update headline/description, transition-status queries — one per transition as in the spec's state diagram).
- `marketplace_listing_capabilities`: add, soft-remove (set removed_at), list-current-capabilities-for-listing.
- `CountActiveOrPendingListingsForOrg`:
  ```sql
  SELECT COUNT(*)::int FROM marketplace_listings WHERE org_id = @org_id AND status IN ('active','pending_review');
  ```
- Subscription CRUD: upsert-active (with reactivation behaviour per spec — if existing row is cancelled/expired, set status=active + new started_at; if active, 409), cancel (consumer), admin-cancel, list-by-consumer paginated, get by (provider_org_domain, provider_listing_number, consumer_org_id).

### 2.4 TypeSpec — rewrite

Create `specs/typespec/org/marketplace.tsp` fresh. Differences from the v1 file:

- Listing model fields: `listing_id`, `org_domain`, `listing_number: int32`, `headline`, `description`, `capabilities: string[]` (IDs), `status`, `suspension_note?`, `rejection_note?`, `listed_at?`, `active_subscriber_count`, `created_at`, `updated_at`.
- Listing card model: include `listing_number` + `capabilities` array.
- Subscription model: no `capability_id`. Add `provider_listing_number` + `provider_org_domain`.
- Requests for `CreateListingRequest`: `capabilities: string[]` (min 1 max 5), `headline`, `description`. No more single `capability_id`.
- All get/edit requests use `(provider_org_domain, listing_number)` as the key — e.g. `GetListingRequest{ org_domain: string; listing_number: int32 }`.
- Remove all references to listing-id-based URL. Internal-only.
- Route names remain under `/org/marketplace/...`. Keep endpoints close to the v1 list but adjust request shapes.
- `RejectListingRequest` now requires `rejection_note` (1–2000 chars).

Create `specs/typespec/admin/marketplace.tsp`:

- `CreateCapability`, `UpdateCapability` (status + translations map), `ListCapabilities` (all statuses), admin-suspend-listing, admin-reinstate-listing, admin-cancel-subscription, admin-list-listings (across regions via `marketplace_listing_catalog` + per-region joins).

Compile TypeSpec, then handwrite the `.ts` and `.go` sibling files with validators.

### 2.5 Backend handlers

New files under `api-server/handlers/org/`:

- `marketplace-capability-list.go` (reads active capabilities from global DB with locale fallback)
- `marketplace-capability-get.go`
- `marketplace-listing-create.go`
  - Inside `WithRegionalTx`: enforce `QuotaMarketplaceListings` (Free tier has cap 0 → immediate 403). Call `NextListingNumberForOrg`. Insert listing + capabilities join rows. Audit log.
- `marketplace-listing-update.go` (draft or active; preserve history — just UPDATE and touch `updated_at`)
- `marketplace-listing-publish.go` — role is `org:manage_listings`. If caller is `org:superadmin` → `active` directly + set `listed_at` + upsert global catalog row. Else → `pending_review` (quota enforced including pending_review count).
- `marketplace-listing-approve.go` — `org:superadmin` only. Transition `pending_review → active`, set `listed_at`, upsert catalog row.
- `marketplace-listing-reject.go` — `org:superadmin` only. Transition `pending_review → draft`, store `rejection_note`.
- `marketplace-listing-archive.go` — transition active/suspended → archived, delete catalog row.
- `marketplace-listing-reopen.go` — archived → draft.
- `marketplace-listing-list.go` — own listings.
- `marketplace-listing-get.go` — by `(org_domain, listing_number)`. If the caller's org matches, return full record. Else rely on the global catalog row for cross-org buyer view.
- `marketplace-discover-list.go` — reads global `marketplace_listing_catalog`, filter by capability (GIN any-match) + optional full-text. Keyset.
- `marketplace-subscription-subscribe.go` — consumer side. Validates listing exists in global catalog. Writes subscription row in consumer's regional DB + upserts global subscription_index. Uses cross-DB pattern (global first then regional — or vice versa; pick the one that matches existing patterns; compensating tx on failure). Reject self-subscription (consumer org == provider org).
- `marketplace-subscription-cancel.go` — consumer side.
- `marketplace-subscription-list.go` — consumer's own subscriptions.
- `marketplace-subscription-get.go` — by `(provider_org_domain, provider_listing_number)` for the viewer's consumer org.
- `marketplace-clients-list.go` — provider side. Reads `marketplace_subscription_index` filtered by `provider_org_id = my_org_id`; joins regional subscription rows for per-consumer details.
- `marketplace-helpers.go` — capability-resolution helpers (validate capability_ids exist and are `active`/`draft` for admin / `active` for non-admin), catalog upsert helpers.

Admin handlers under `api-server/handlers/admin/`:

- `marketplace-capability-create.go`, `-update.go`, `-list.go` (admin sees all statuses).
- `marketplace-listing-admin-list.go`, `-suspend.go`, `-reinstate.go`, `-admin-get.go` (admin reads across regions via catalog + then pulls full record from the right regional DB using the existing cross-region query mechanism the admin layer already uses).
- `marketplace-subscription-admin-list.go`, `-admin-cancel.go`.

**Route registration**: add all new routes in `api-server/cmd/regional-api-server/main.go` (for org) and `api-server/cmd/global-service/main.go` (for admin), wrapped in middleware per the table in the spec §5.

### 2.6 Frontend — org portal

New files under `org-ui/src/pages/Marketplace/`:

- `MarketplaceDiscoverPage.tsx` — `/marketplace/discover`. Grid of listing cards (headline, provider org, capability pills, truncated description). Filters: multi-select capabilities, full-text box.
- `MarketplaceListingPage.tsx` — `/marketplace/listings/:orgDomain/:listingNumber`. Role-aware: buyer view (Subscribe/Re-subscribe button, existing subscription banner), provider view (Edit/Archive/Publish/Approve/Reject/Reopen + Subscribers list), admin view (Suspend/Reinstate).
- `MyListingsPage.tsx` — `/marketplace/listings`. Table of own listings. Create button, disabled with upgrade prompt at cap.
- `CreateListingPage.tsx` — `/marketplace/listings/new`. Capabilities multi-select, headline, description. Buttons Save Draft / Publish. Reads `?capability=<id>` for pre-fill.
- `EditListingPage.tsx` — `/marketplace/listings/:orgDomain/:listingNumber/edit`.
- `MySubscriptionsPage.tsx` — `/marketplace/subscriptions`.
- `SubscriptionDetailPage.tsx` — `/marketplace/subscriptions/:providerDomain/:listingNumber`.
- `MyClientsPage.tsx` — `/marketplace/clients`.

Wire all routes in `org-ui/src/App.tsx`. **Literal routes before pattern routes**: `/marketplace/listings` and `/marketplace/listings/new` must be declared before `/marketplace/listings/:orgDomain/:listingNumber`.

Dashboard tiles: Marketplace (all users), My Listings (view/manage_listings), My Subscriptions (view/manage_subscriptions), My Clients (view/manage_listings).

### 2.7 Frontend — admin portal

Under `admin-ui/src/pages/Marketplace/`:

- `CapabilitiesPage.tsx` — list + create/edit modal with per-locale display_name/description, status dropdown. No fee fields.
- `ListingsPage.tsx` — admin view across all orgs. Filters: org, capability, status. Row click → detail page with Suspend/Reinstate actions.
- `SubscriptionsPage.tsx` — all subscriptions. Admin-cancel action.

No `BillingPage.tsx` — billing is out of scope.

### 2.8 i18n

Add `marketplace` translations for `en-US` / `de-DE` / `ta-IN`. Keep strings minimal.

### 2.9 Playwright tests

**Re-add test helpers first**, in the same files they were stripped from in Phase 0:

- `playwright/lib/org-api-client.ts`: add typed V2 methods (one per new `/org/marketplace/...` endpoint) plus `*Raw()` variants for 400 coverage. Import request/response types from `vetchium-specs/org/marketplace`.
- `playwright/lib/admin-api-client.ts`: add V2 methods for admin endpoints.
- `playwright/lib/db.ts`:
  - Re-add the marketplace DELETE cleanup in `deleteTestOrg*` helpers (now operating on V2 tables: `marketplace_subscriptions`, `marketplace_listing_capabilities`, `marketplace_listings`, `org_marketplace_listing_counters` regionally; `marketplace_listing_catalog`, `marketplace_subscription_index` globally — no billing tables exist in V2).
  - Rewrite `createTestMarketplaceCapability` for V2 schema (no changes other than status check constraint). Keep the signature so future specs can reuse.
  - Add `createTestMarketplaceListingDirect(orgId, capabilityIds[], status)` that bypasses the API: insert into `marketplace_listings`, capability-join rows, bump the counter, and optionally upsert the catalog row if status is active. Needed by RBAC + quota tests.
  - Add `setOrgTier(orgId, tierId)` helper that directly updates `org_subscriptions.current_tier_id` — quota tests need to put an org on Silver/Gold without driving the self-upgrade flow.

Create `playwright/tests/api/org/marketplace.spec.ts` covering:

- Capability list (public to authenticated org user).
- Listing CRUD happy path (draft → active via superadmin publish).
- Non-superadmin publish → pending_review; superadmin approve → active; reject with note → draft with rejection_note surfaced.
- Multi-capability listing: 2 capabilities on create; remove one via update; removing last → 422.
- Quota exceeded: Silver org creates 5 active listings, 6th → 403 with quota payload.
- Subscribe: consumer org subscribes → active. Re-subscribe after cancellation reactivates same row.
- Self-subscription rejected (provider = consumer).
- Consumer cancel; provider sees cancelled in clients list.
- RBAC positive/negative for every role-protected endpoint.
- Audit logs assertions on every write.

Create `playwright/tests/api/admin/marketplace.spec.ts`:

- Capability create (draft → active → disable).
- Admin suspend/reinstate listing.
- Admin cancel subscription.
- Admin RBAC.

**UI tests** — rewrite `playwright/tests/ui/org/marketplace.spec.ts` from scratch, covering:

- Discover page renders cards, capability filter narrows results.
- Create listing form — capability multi-select, headline/description limits, Save Draft navigates to /marketplace/listings.
- Publish as superadmin → card shows Active status.
- Quota-exceeded path: set the test org's tier to Free via `setOrgTier`, click Publish → `QuotaExceededModal` appears with link to `/settings/subscription`.
- Subscribe flow: consumer org logs in, opens listing, clicks Subscribe → Subscription Detail page shows Provider contact.

Create `playwright/tests/ui/admin/marketplace.spec.ts`:

- Capability list + create.
- Listing admin view with Suspend action.

**Org Tiers UI tests** — add `playwright/tests/ui/org/subscription.spec.ts`:

- `/settings/subscription` shows current tier Free, usage rows, Upgrade to Silver button present.
- Click Upgrade to Silver → confirm modal → success toast → current tier flips to Silver.
- `self_upgradeable=false` tier (Enterprise) has no Upgrade button.

And `playwright/tests/ui/admin/org-subscriptions.spec.ts`:

- Admin opens `/admin/org-subscriptions`, sets a listed org's tier via modal, reason required.
- Downgrade blocked response surfaces blocking-usage table in the modal.

### 2.10 Connect quota enforcement

In `marketplace-listing-create.go` and `marketplace-listing-publish.go` (for the `draft → pending_review` path), call `orgtiers.EnforceQuota(ctx, QuotaMarketplaceListings, orgID)` before transitioning the listing to a counted state. Counted states = `active` + `pending_review`. Draft creation does not count — only `Publish` / `SubmitForReview` counts.

Wait — re-reading §4.2 of the spec: quota applies when "publish or submit-for-review". So:

- `Create` just creates a `draft`. No quota check.
- `Publish` / submit-for-review → quota check before transitioning to `active` / `pending_review`.

Update the handlers to do the check at the right step.

**Commit**: `feat: marketplace v2 — multi-capability listings + tier-gated publishing`

---

## Phase 3 — Integration sanity pass

- Run `cd api-server && sqlc generate && go build ./...` — fix any type drift.
- Run `cd specs/typespec && tsp compile .` — fix any schema drift.
- Run `bun run lint` in both `org-ui` and `admin-ui` — fix warnings incl. deprecated Ant Design API usage.
- `docker compose -f docker-compose-ci.json up --build -d` then `cd playwright && npm test` — expect all green.

**Commit**: `chore: build + lint + test green`

---

## Phase 4 — Memory

Update `MEMORY.md` with:

- Org Tiers system exists with 4 tiers (free/silver/gold/enterprise).
- Quotas enforced for: org_users, domains_verified, suborgs, marketplace_listings.
- Marketplace uses multi-capability listings, `(org_domain, listing_number)` URL key, per-org counter.
- No marketplace billing table. Tier upgrades are free (no payment infra in V1).
- Self-upgrade requires `org:manage_subscription` + `self_upgradeable = true` on the target tier.

---

## Reference patterns (for the executor)

- Handler skeleton: see `api-server/handlers/org/claim-domain.go`.
- Cross-DB transaction pattern: see `api-server/handlers/org/complete-signup.go`.
- Keyset pagination sqlc: see existing `ListAllMarketplaceListings` shape (deleted in Phase 0 but it's in git history).
- Feature page layout: see any `*Page.tsx` in `org-ui/src/pages/UserManagement/` or `CostCenters/`.
- Playwright RBAC test pattern: see `playwright/tests/api/admin/login.spec.ts` plus any spec with an RBAC `describe` block.
- Role names: `specs/typespec/common/roles.ts` (keep in sync with `roles.go`).

## Hard rules (do not deviate)

- All API JSON fields are snake_case.
- All API request/response types imported from `specs/typespec/` — never defined locally.
- All writes inside `WithGlobalTx` / `WithRegionalTx`, including audit log writes.
- Audit logs: never store raw emails (hash only); extract IP from `X-Forwarded-For` then `RemoteAddr`.
- No new indexes for performance; only `UNIQUE` in CREATE TABLE.
- No OFFSET anywhere — keyset pagination only.
- TypeScript: annotate enum arrays/comparisons with the imported enum type; no string-literal comparisons without the type.
