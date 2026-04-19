# Rename Plan: "tier" + "subscription" (org billing) → "plan"

## Goal

Eliminate the word "tier" and the word "subscription" (for the org billing concept) everywhere.
Replace both with "plan" in code/APIs and "Vetchium Plan" in UI display strings.

Do NOT touch anything related to marketplace subscriptions:

- `marketplace_subscription_index` table
- `/org/marketplace/subscription/*` routes
- `MarketplaceSubscription` types
- `org:view_subscriptions` / `org:manage_subscriptions` roles
- `OrgRoleViewSubscriptions` / `OrgRoleManageSubscriptions` constants

---

## Naming Map

### DB columns

| Before                           | After                           |
| -------------------------------- | ------------------------------- |
| `plans.tier_id` (PK)             | `plans.plan_id`                 |
| `plan_translations.tier_id` (FK) | `plan_translations.plan_id`     |
| `org_plans.current_tier_id`      | `org_plans.current_plan_id`     |
| `org_plan_history.from_tier_id`  | `org_plan_history.from_plan_id` |
| `org_plan_history.to_tier_id`    | `org_plan_history.to_plan_id`   |

### DB tables

| Before                     | After               |
| -------------------------- | ------------------- |
| `org_tiers`                | `plans`             |
| `org_tier_translations`    | `plan_translations` |
| `org_subscriptions`        | `org_plans`         |
| `org_subscription_history` | `org_plan_history`  |

### sqlc query names

| Before                         | After                  |
| ------------------------------ | ---------------------- |
| `ListOrgTiers`                 | `ListPlans`            |
| `GetOrgTier`                   | `GetPlan`              |
| `GetOrgSubscription`           | `GetOrgPlan`           |
| `UpsertOrgSubscription`        | `UpsertOrgPlan`        |
| `UpdateOrgSubscriptionTier`    | `UpdateOrgPlan`        |
| `InsertOrgSubscriptionHistory` | `InsertOrgPlanHistory` |
| `AdminListOrgSubscriptions`    | `AdminListOrgPlans`    |

### TypeSpec types (specs/typespec/org/tiers.ts and tiers.go)

| Before                              | After                       |
| ----------------------------------- | --------------------------- |
| `OrgTier`                           | `Plan`                      |
| `OrgTierUsage`                      | `PlanUsage`                 |
| `OrgSubscription`                   | `OrgPlan`                   |
| `ListOrgTiersRequest`               | `ListPlansRequest`          |
| `ListOrgTiersResponse`              | `ListPlansResponse`         |
| `GetMyOrgSubscriptionRequest`       | `GetMyOrgPlanRequest`       |
| `SelfUpgradeOrgSubscriptionRequest` | `UpgradeOrgPlanRequest`     |
| `AdminListOrgSubscriptionsRequest`  | `AdminListOrgPlansRequest`  |
| `AdminListOrgSubscriptionsResponse` | `AdminListOrgPlansResponse` |
| `AdminSetOrgTierRequest`            | `AdminSetOrgPlanRequest`    |

### TypeSpec type field names

| Before                                            | After                                     |
| ------------------------------------------------- | ----------------------------------------- |
| `OrgTier.tier_id` / `.TierID`                     | `Plan.plan_id` / `.PlanID`                |
| `OrgSubscription.current_tier` / `.CurrentTier`   | `OrgPlan.current_plan` / `.CurrentPlan`   |
| `SelfUpgradeOrgSubscriptionRequest.tier_id`       | `UpgradeOrgPlanRequest.plan_id`           |
| `AdminListOrgSubscriptionsRequest.filter_tier_id` | `AdminListOrgPlansRequest.filter_plan_id` |
| `AdminSetOrgTierRequest.tier_id`                  | `AdminSetOrgPlanRequest.plan_id`          |
| `ListOrgTiersResponse.tiers`                      | `ListPlansResponse.plans`                 |
| `AdminListOrgSubscriptionsResponse.items`         | stays `items`                             |
| error message `"must be a valid tier id"`         | `"must be a valid plan id"`               |

### Go validator functions (TS only — Go uses .Validate() methods)

| Before                                      | After                              |
| ------------------------------------------- | ---------------------------------- |
| `validateSelfUpgradeOrgSubscriptionRequest` | `validateUpgradeOrgPlanRequest`    |
| `validateAdminListOrgSubscriptionsRequest`  | `validateAdminListOrgPlansRequest` |
| `validateAdminSetOrgTierRequest`            | `validateAdminSetOrgPlanRequest`   |

### Role strings

| Before                           | After                    |
| -------------------------------- | ------------------------ |
| `org:view_subscription`          | `org:view_plan`          |
| `org:manage_subscription`        | `org:manage_plan`        |
| `admin:view_org_subscriptions`   | `admin:view_org_plans`   |
| `admin:manage_org_subscriptions` | `admin:manage_org_plans` |

### Role constants (Go + TS)

| Before                            | After                     |
| --------------------------------- | ------------------------- |
| `OrgRoleViewSubscription`         | `OrgRoleViewPlan`         |
| `OrgRoleManageSubscription`       | `OrgRoleManagePlan`       |
| `AdminRoleViewOrgSubscriptions`   | `AdminRoleViewOrgPlans`   |
| `AdminRoleManageOrgSubscriptions` | `AdminRoleManageOrgPlans` |

### API routes

| Before                                     | After                           |
| ------------------------------------------ | ------------------------------- |
| `POST /org/org-subscriptions/list-tiers`   | `POST /org/org-plan/list-plans` |
| `POST /org/org-subscriptions/get`          | `POST /org/org-plan/get`        |
| `POST /org/org-subscriptions/self-upgrade` | `POST /org/org-plan/upgrade`    |
| `POST /admin/org-subscriptions/list`       | `POST /admin/org-plan/list`     |
| `POST /admin/org-subscriptions/set-tier`   | `POST /admin/org-plan/set`      |

### Go handler functions

| Before                       | After              |
| ---------------------------- | ------------------ |
| `ListOrgTiers`               | `ListPlans`        |
| `GetMyOrgSubscription`       | `GetMyOrgPlan`     |
| `SelfUpgradeOrgSubscription` | `UpgradeOrgPlan`   |
| `ListOrgSubscriptions`       | `ListOrgPlans`     |
| `SetOrgTier`                 | `SetOrgPlan`       |
| `buildOrgTier`               | `buildPlan`        |
| `buildOrgTierFromRow`        | `buildPlanFromRow` |

### Go handler files (rename)

| Before                                          | After                                 |
| ----------------------------------------------- | ------------------------------------- |
| `handlers/org/org-subscription-get.go`          | `handlers/org/org-plan-get.go`        |
| `handlers/org/org-subscription-list-tiers.go`   | `handlers/org/org-plan-list-plans.go` |
| `handlers/org/org-subscription-self-upgrade.go` | `handlers/org/org-plan-upgrade.go`    |
| `handlers/org/org-subscription-helpers.go`      | `handlers/org/org-plan-helpers.go`    |
| `handlers/admin/org-subscription-list.go`       | `handlers/admin/org-plan-list.go`     |
| `handlers/admin/org-subscription-set-tier.go`   | `handlers/admin/org-plan-set.go`      |

### Internal package: api-server/internal/orgtiers/orgtiers.go

| Before                                           | After                        |
| ------------------------------------------------ | ---------------------------- |
| `QuotaExceededPayload.TierID` / `json:"tier_id"` | `.PlanID` / `json:"plan_id"` |
| `GetOrgSubscription(...)` call                   | `GetOrgPlan(...)`            |
| `sub.CurrentTierID`                              | `sub.CurrentPlanID`          |

### Frontend routes

| Before                           | After            |
| -------------------------------- | ---------------- |
| org-ui: `/settings/subscription` | `/settings/plan` |
| admin-ui: `/org-subscriptions`   | `/org-plans`     |

### Frontend components

| Before                                                          | After                                 |
| --------------------------------------------------------------- | ------------------------------------- |
| org-ui: `src/pages/Subscription/SubscriptionPage.tsx`           | `src/pages/Plan/PlanPage.tsx`         |
| admin-ui: `src/pages/OrgSubscriptions/OrgSubscriptionsPage.tsx` | `src/pages/OrgPlans/OrgPlansPage.tsx` |

### i18n namespaces + files

| Before                                           | After                          |
| ------------------------------------------------ | ------------------------------ |
| org-ui: `subscription` namespace                 | `plan` namespace               |
| org-ui: `src/locales/*/subscription.json`        | `src/locales/*/plan.json`      |
| admin-ui: `orgSubscriptions` namespace           | `orgPlans` namespace           |
| admin-ui: `src/locales/*/org-subscriptions.json` | `src/locales/*/org-plans.json` |

### i18n string content changes

In org-ui plan.json: rename all `subscription.*` keys to `plan.*`; display text uses "Vetchium Plan".
In admin-ui org-plans.json: rename all `orgSubscriptions.*` keys to `orgPlans.*`; display text uses "Vetchium Plan".
In org-ui marketplace.json: `quotaExceeded` uses `{{tier}}` → change to `{{plan}}` in all three locale files.
The `listing.publishQuotaTooltip` and `create.quotaBanner` and `listings.quotaTooltip` etc. use `tier` → change to `plan`.

### Frontend API calls (SubscriptionPage → PlanPage)

`/org/org-subscriptions/get` → `/org/org-plan/get`
`/org/org-subscriptions/list-tiers` → `/org/org-plan/list-plans`
`/org/org-subscriptions/self-upgrade` → `/org/org-plan/upgrade`

### Quota-related frontend JSON field reads

Files: org-ui marketplace pages + QuotaExceededModal
`payload.tier_id` → `payload.plan_id`
`subscription.current_tier` → `subscription.current_plan`
`tier.tier_id` → `plan.plan_id`

### Playwright API clients

`playwright/lib/admin-api-client.ts`:

- Import: `OrgSubscription as AdminSetOrgTierResponse` → `OrgPlan as AdminSetOrgPlanResponse`
- Import: `AdminSetOrgTierRequest` → `AdminSetOrgPlanRequest`
- Import: `AdminListOrgSubscriptionsRequest`, `AdminListOrgSubscriptionsResponse` → renamed types
- Method `setOrgTier` → `setOrgPlan`
- Method `setOrgTierRaw` → `setOrgPlanRaw`
- Method `listOrgSubscriptions` → `listOrgPlans`
- API URLs updated

`playwright/lib/org-api-client.ts`:

- Import: `ListOrgTiersResponse` → `ListPlansResponse`
- Method `listOrgTiers` → `listPlans`
- Method `getMyOrgSubscription` → `getMyOrgPlan`
- Method `selfUpgradeOrgSubscription` → `upgradeOrgPlan`
- API URLs updated

### Playwright db.ts

- `setOrgTier(orgId, tierId)` → `setOrgPlan(orgId, planId)`
- SQL: `org_subscriptions` → `org_plans`, `current_tier_id` → `current_plan_id`
- SQL: `org_subscription_history` → `org_plan_history`
- Comments: "free tier" → "free plan"

### Playwright test files (rename + update)

| Before                                     | After                              |
| ------------------------------------------ | ---------------------------------- |
| `tests/api/admin/org-subscription.spec.ts` | `tests/api/admin/org-plan.spec.ts` |
| `tests/api/org/org-subscription.spec.ts`   | `tests/api/org/org-plan.spec.ts`   |
| `tests/ui/admin/org-subscriptions.spec.ts` | `tests/ui/admin/org-plans.spec.ts` |
| `tests/ui/org/subscription.spec.ts`        | `tests/ui/org/org-plan.spec.ts`    |

Inside each file: update all type imports, method calls, API URLs, describe/test names.

Also update any other test files that import `setOrgTier` from db.ts:

- `tests/api/org/suborgs.spec.ts` — update `setOrgTier` → `setOrgPlan`
- `tests/api/org/marketplace.spec.ts` — check for setOrgTier usage

### DashboardPage (org-ui)

- `hasSubscriptionAccess` → `hasPlanAccess`
- role checks: `org:view_subscription` → `org:view_plan`, `org:manage_subscription` → `org:manage_plan`
- Link: `/settings/subscription` → `/settings/plan`
- i18n key: `subscription.title` → `plan.title`, `subscription.description` → `plan.description`
- common.json: rename the `"subscription"` key to `"plan"` (for dashboard tile)

### DashboardPage (admin-ui)

- `canViewOrgSubscriptions` → `canViewOrgPlans`
- role checks: `admin:view_org_subscriptions` → `admin:view_org_plans`
- Link: `/org-subscriptions` → `/org-plans`
- i18n: `orgSubscriptions.*` → `orgPlans.*`

### complete-signup.go

- `CurrentTierID: "free"` → `CurrentPlanID: "free"`
- `FromTierID: pgtype.Text{Valid: false}` → `FromPlanID: pgtype.Text{Valid: false}`
- `ToTierID: "free"` → `ToPlanID: "free"`

### marketplace-listing-publish.go (and any other handler using orgtiers quota)

- `payload.TierID` (from QuotaExceededPayload) — auto-fixed when orgtiers.go is updated

---

## Step-by-Step Implementation Order

### Step 1: DB Migration

File: `api-server/db/migrations/global/00000000000001_initial_schema.sql`

Changes:

1. Rename `CREATE TABLE org_tiers` → `CREATE TABLE plans`; rename PK column `tier_id` → `plan_id`
2. Rename `CREATE TABLE org_tier_translations` → `CREATE TABLE plan_translations`; rename `tier_id` FK → `plan_id`; update `PRIMARY KEY (tier_id, locale)` → `PRIMARY KEY (plan_id, locale)`; update `REFERENCES org_tiers(tier_id)` → `REFERENCES plans(plan_id)`
3. Rename `CREATE TABLE org_subscriptions` → `CREATE TABLE org_plans`; rename column `current_tier_id` → `current_plan_id`; update `REFERENCES org_tiers(tier_id)` → `REFERENCES plans(plan_id)`
4. Rename `CREATE TABLE org_subscription_history` → `CREATE TABLE org_plan_history`; rename `from_tier_id` → `from_plan_id`; rename `to_tier_id` → `to_plan_id`
5. Update `INSERT INTO org_tiers` → `INSERT INTO plans` (keep values, rename column header `tier_id` → `plan_id`)
6. Update `INSERT INTO org_tier_translations` → `INSERT INTO plan_translations` (rename column `tier_id` → `plan_id`)
7. Update admin role descriptions: `admin:view_org_subscriptions` → `admin:view_org_plans`; `admin:manage_org_subscriptions` → `admin:manage_org_plans`; update role descriptions text too
8. Update org role insert rows: `org:view_subscription` → `org:view_plan`; `org:manage_subscription` → `org:manage_plan`; update descriptions
9. Update DROP TABLE statements: `org_subscription_history` → `org_plan_history`; `org_subscriptions` → `org_plans`; `org_tier_translations` → `plan_translations`; `org_tiers` → `plans`

### Step 2: SQL Queries

File: `api-server/db/queries/global.sql`

Changes:

1. `-- name: ListOrgTiers :many` → `-- name: ListPlans :many`; `FROM org_tiers t` → `FROM plans t`; `t.tier_id` → `t.plan_id`; `tr.tier_id` → `tr.plan_id`; `ON t.tier_id = tr.tier_id` → `ON t.plan_id = tr.plan_id`; `WHERE tier_id = @tier_id` → `WHERE plan_id = @plan_id`
2. `-- name: GetOrgTier :one` → `-- name: GetPlan :one`; `FROM org_tiers WHERE tier_id = @tier_id` → `FROM plans WHERE plan_id = @plan_id`
3. `-- name: GetOrgSubscription :one` → `-- name: GetOrgPlan :one`; `FROM org_subscriptions s` → `FROM org_plans s`; `JOIN org_tiers t ON s.current_tier_id = t.tier_id` → `JOIN plans t ON s.current_plan_id = t.plan_id`; `t.tier_id AS tier_key` → `t.plan_id AS plan_key`
4. Rename `-- name: UpsertOrgSubscription :exec` → `-- name: UpsertOrgPlan :exec`; `INSERT INTO org_subscriptions (org_id, current_tier_id, ...)` → `INSERT INTO org_plans (org_id, current_plan_id, ...)`; `@current_tier_id` → `@current_plan_id`
5. `-- name: UpdateOrgSubscriptionTier :exec` → `-- name: UpdateOrgPlan :exec`; `UPDATE org_subscriptions` → `UPDATE org_plans`; `current_tier_id = @current_tier_id` → `current_plan_id = @current_plan_id`
6. `-- name: InsertOrgSubscriptionHistory :exec` → `-- name: InsertOrgPlanHistory :exec`; `INSERT INTO org_subscription_history (org_id, from_tier_id, to_tier_id, ...)` → `INSERT INTO org_plan_history (org_id, from_plan_id, to_plan_id, ...)`; `@from_tier_id` → `@from_plan_id`; `@to_tier_id` → `@to_plan_id`
7. `-- name: AdminListOrgSubscriptions :many` → `-- name: AdminListOrgPlans :many`; `FROM org_subscriptions s` → `FROM org_plans s`; `s.current_tier_id` → `s.current_plan_id`; `sqlc.narg('filter_tier_id')` → `sqlc.narg('filter_plan_id')`; `GROUP BY s.org_id, s.current_tier_id, ...` → `GROUP BY s.org_id, s.current_plan_id, ...`

Note: The column alias `t.tier_id AS tier_key` in `GetOrgTier` query — in new query `GetPlan` there is no alias needed; and the `GetOrgPlan` SELECT uses `t.plan_id AS plan_key` but the sqlc-generated struct field will be `PlanKey`. After sqlc regen all Go callers must use new field names.

### Step 3: Regenerate sqlc

Run: `cd api-server && sqlc generate`
This regenerates `internal/db/globaldb/` with new function names and struct fields.

### Step 4: TypeSpec types

File: `specs/typespec/org/tiers.go`

- Rename struct `OrgTier` → `Plan`; field `TierID string \`json:"tier_id"\``→`PlanID string \`json:"plan_id"\``; keep all other fields
- Rename struct `OrgTierUsage` → `PlanUsage`; keep all fields
- Rename struct `OrgSubscription` → `OrgPlan`; field `CurrentTier OrgTier` → `CurrentPlan Plan`; field `Usage OrgTierUsage` → `Usage PlanUsage`
- Rename struct `ListOrgTiersRequest` → `ListPlansRequest`
- Rename struct `ListOrgTiersResponse` → `ListPlansResponse`; field `Tiers []OrgTier` → `Plans []Plan`
- Rename struct `GetMyOrgSubscriptionRequest` → `GetMyOrgPlanRequest`
- Rename struct `SelfUpgradeOrgSubscriptionRequest` → `UpgradeOrgPlanRequest`; field `TierID string \`json:"tier_id"\``→`PlanID string \`json:"plan_id"\``
- Rename struct `AdminListOrgSubscriptionsRequest` → `AdminListOrgPlansRequest`; field `FilterTierID *string \`json:"filter_tier_id,omitempty"\``→`FilterPlanID \*string \`json:"filter_plan_id,omitempty"\``
- Rename struct `AdminListOrgSubscriptionsResponse` → `AdminListOrgPlansResponse`; field `Items []OrgSubscription` → `Items []OrgPlan`
- Rename struct `AdminSetOrgTierRequest` → `AdminSetOrgPlanRequest`; field `TierID string \`json:"tier_id"\``→`PlanID string \`json:"plan_id"\``
- Update `isValidTierID` → `isValidPlanID`; update `validTierIDs` → `validPlanIDs`
- Update all `.Validate()` methods to use new field names
- Update error `errInvalidTierID` → `errInvalidPlanID`; message `"must be a valid tier id (free, silver, gold, enterprise)"` → `"must be a valid plan id (free, silver, gold, enterprise)"`

File: `specs/typespec/org/tiers.ts`

- Same renames as tiers.go (TypeScript interface/function names)
- Rename `validateSelfUpgradeOrgSubscriptionRequest` → `validateUpgradeOrgPlanRequest`
- Rename `validateAdminListOrgSubscriptionsRequest` → `validateAdminListOrgPlansRequest`
- Rename `validateAdminSetOrgTierRequest` → `validateAdminSetOrgPlanRequest`
- `VALID_TIER_IDS` → `VALID_PLAN_IDS`; `TierId` type → `PlanId`
- Field `tier_id` → `plan_id` in interfaces; `filter_tier_id` → `filter_plan_id`; `tiers: OrgTier[]` → `plans: Plan[]`; `current_tier: OrgTier` → `current_plan: Plan`

### Step 5: Role constants

File: `specs/typespec/common/roles.go`

- `"admin:view_org_subscriptions"` → `"admin:view_org_plans"`
- `"admin:manage_org_subscriptions"` → `"admin:manage_org_plans"`
- `"org:view_subscription"` → `"org:view_plan"`
- `"org:manage_subscription"` → `"org:manage_plan"`

File: `specs/typespec/common/roles.ts`

- Same four role string changes

File: `specs/typespec/org/org-users.go`

- `OrgRoleViewSubscription  OrgRole = "org:view_subscription"` → `OrgRoleViewPlan  OrgRole = "org:view_plan"`
- `OrgRoleManageSubscription OrgRole = "org:manage_subscription"` → `OrgRoleManagePlan OrgRole = "org:manage_plan"`

File: `specs/typespec/org/org-users.ts`

- Same two constant renames

File: `specs/typespec/admin/admin-users.go`

- `AdminRoleViewOrgSubscriptions  AdminRole = "admin:view_org_subscriptions"` → `AdminRoleViewOrgPlans  AdminRole = "admin:view_org_plans"`
- `AdminRoleManageOrgSubscriptions AdminRole = "admin:manage_org_subscriptions"` → `AdminRoleManageOrgPlans AdminRole = "admin:manage_org_plans"`

File: `specs/typespec/admin/admin-users.ts` (if it has these constants — check)

- Same two renames

### Step 6: Internal orgtiers package

File: `api-server/internal/orgtiers/orgtiers.go`

- `QuotaExceededPayload.TierID string \`json:"tier_id"\``→`PlanID string \`json:"plan_id"\``
- `global.GetOrgSubscription(ctx, orgID)` → `global.GetOrgPlan(ctx, orgID)`
- `sub.CurrentTierID` → `sub.CurrentPlanID`
- In the payload: `TierID: sub.CurrentTierID` → `PlanID: sub.CurrentPlanID`

### Step 7: Go handler files

For each handler file below, rename the file AND update its contents.

**Rename + update `handlers/org/org-subscription-get.go` → `handlers/org/org-plan-get.go`**

- Function `GetMyOrgSubscription` → `GetMyOrgPlan`
- Type `orgtypes.GetMyOrgSubscriptionRequest` → `orgtypes.GetMyOrgPlanRequest`
- `s.Global.GetOrgSubscription(ctx, orgUser.OrgID)` → `s.Global.GetOrgPlan(ctx, orgUser.OrgID)`

**Rename + update `handlers/org/org-subscription-list-tiers.go` → `handlers/org/org-plan-list-plans.go`**

- Function `ListOrgTiers` → `ListPlans`
- `s.Global.ListOrgTiers(ctx, locale)` → `s.Global.ListPlans(ctx, locale)`
- `tiers := make([]orgtypes.OrgTier, 0, len(rows))` → `plans := make([]orgtypes.Plan, 0, len(rows))`
- `tiers = append(tiers, buildPlanFromRow(row))`
- `orgtypes.ListOrgTiersResponse{Tiers: tiers}` → `orgtypes.ListPlansResponse{Plans: plans}`

**Rename + update `handlers/org/org-subscription-self-upgrade.go` → `handlers/org/org-plan-upgrade.go`**

- Function `SelfUpgradeOrgSubscription` → `UpgradeOrgPlan`
- `var req orgtypes.SelfUpgradeOrgSubscriptionRequest` → `var req orgtypes.UpgradeOrgPlanRequest`
- `s.Global.GetOrgSubscription(ctx, orgUser.OrgID)` → `s.Global.GetOrgPlan(ctx, orgUser.OrgID)`
- `targetTier, txErr := qtx.GetOrgTier(ctx, req.TierID)` → `targetPlan, txErr := qtx.GetPlan(ctx, req.PlanID)`
- `req.TierID == sub.CurrentTierID` → `req.PlanID == sub.CurrentPlanID`
- `CurrentTierID: req.TierID` → `CurrentPlanID: req.PlanID`
- `fromTierID = sub.CurrentTierID` → `fromPlanID = sub.CurrentPlanID`
- `FromTierID: pgtype.Text{String: sub.CurrentTierID, Valid: true}` → `FromPlanID: pgtype.Text{String: sub.CurrentPlanID, Valid: true}`
- `ToTierID: req.TierID` → `ToPlanID: req.PlanID`
- `"from_tier_id": fromTierID` → `"from_plan_id": fromPlanID`
- `"to_tier_id": req.TierID` → `"to_plan_id": req.PlanID`
- `s.Global.InsertOrgSubscriptionHistory` → `s.Global.InsertOrgPlanHistory`
- `s.Global.UpdateOrgSubscriptionTier` → `s.Global.UpdateOrgPlan`

**Rename + update `handlers/org/org-subscription-helpers.go` → `handlers/org/org-plan-helpers.go`**

- `buildOrgTier` → `buildPlan`; return type `orgtypes.OrgTier` → `orgtypes.Plan`
  - `TierID: sub.CurrentTierID` → `PlanID: sub.CurrentPlanID`
  - `sub.TierKey` → `sub.PlanKey` (after sqlc regen, the column alias changes)
- `buildOrgTierFromRow` → `buildPlanFromRow`; return type `orgtypes.OrgTier` → `orgtypes.Plan`
  - `TierID: row.TierID` → `PlanID: row.PlanID`
- `buildOrgSubscription` → `buildOrgPlan`; return type `orgtypes.OrgSubscription` → `orgtypes.OrgPlan`
  - `CurrentTier: tier` → `CurrentPlan: plan`
  - `Usage: orgtypes.OrgTierUsage{...}` → `Usage: orgtypes.PlanUsage{...}`

**Rename + update `handlers/admin/org-subscription-list.go` → `handlers/admin/org-plan-list.go`**

- Function `ListOrgSubscriptions` → `ListOrgPlans`
- `var req orgtypes.AdminListOrgSubscriptionsRequest` → `var req orgtypes.AdminListOrgPlansRequest`
- `s.Global.AdminListOrgSubscriptions(ctx, ...)` → `s.Global.AdminListOrgPlans(ctx, ...)`
- `FilterTierID` → `FilterPlanID` in params
- `orgtypes.AdminListOrgSubscriptionsResponse` → `orgtypes.AdminListOrgPlansResponse`
- All uses of `buildOrgSubscription` → `buildOrgPlan` (from helpers, but it's in org package not admin — need to check if admin has its own helper or calls org's)

Note: The admin handler imports from `globaldb` directly. Check what struct fields it reads (e.g. `item.CurrentTierID` → `item.CurrentPlanID`).

**Rename + update `handlers/admin/org-subscription-set-tier.go` → `handlers/admin/org-plan-set.go`**

- Function `SetOrgTier` → `SetOrgPlan`
- `var req orgtypes.AdminSetOrgTierRequest` → `var req orgtypes.AdminSetOrgPlanRequest`
- `req.TierID` → `req.PlanID` throughout
- `s.Global.GetOrgTier(ctx, req.TierID)` → `s.Global.GetPlan(ctx, req.PlanID)`
- `s.Global.GetOrgSubscription(ctx, ...)` → `s.Global.GetOrgPlan(ctx, ...)`
- `s.Global.UpdateOrgSubscriptionTier(ctx, ...)` → `s.Global.UpdateOrgPlan(ctx, ...)`
- `s.Global.InsertOrgSubscriptionHistory(ctx, ...)` → `s.Global.InsertOrgPlanHistory(ctx, ...)`
- `fromTierID` → `fromPlanID`; `CurrentTierID` → `CurrentPlanID`; `FromTierID` → `FromPlanID`; `ToTierID` → `ToPlanID`
- `"from_tier_id"` → `"from_plan_id"`; `"to_tier_id"` → `"to_plan_id"` (in audit event_data)
- `buildOrgTier(updatedSub)` → `buildPlan(updatedSub)` (note: this calls org handler's helper from admin — check import)

### Step 8: Route registration

File: `api-server/internal/routes/org-routes.go`

- `orgRoleViewSubscription := middleware.OrgRole(s.Regional, orgspec.OrgRoleViewSubscription, orgspec.OrgRoleManageSubscription)` → use `OrgRoleViewPlan`, `OrgRoleManagePlan`
- `orgRoleManageSubscription := middleware.OrgRole(s.Regional, orgspec.OrgRoleManageSubscription)` → `OrgRoleManagePlan`
- Route `"POST /org/org-subscriptions/list-tiers"` → `"POST /org/org-plan/list-plans"`
- Route `"POST /org/org-subscriptions/get"` → `"POST /org/org-plan/get"`
- Route `"POST /org/org-subscriptions/self-upgrade"` → `"POST /org/org-plan/upgrade"`
- Handler calls: `org.ListOrgTiers(s)` → `org.ListPlans(s)`; `org.GetMyOrgSubscription(s)` → `org.GetMyOrgPlan(s)`; `org.SelfUpgradeOrgSubscription(s)` → `org.UpgradeOrgPlan(s)`
- Middleware var names: `orgRoleViewSubscription` → `orgRoleViewPlan`; `orgRoleManageSubscription` → `orgRoleManagePlan`

File: `api-server/internal/routes/admin-global-routes.go`

- `adminRoleViewOrgSubscriptions := middleware.AdminRole(s.Global, adminspec.AdminRoleViewOrgSubscriptions, adminspec.AdminRoleManageOrgSubscriptions)` → use `AdminRoleViewOrgPlans`, `AdminRoleManageOrgPlans`
- `adminRoleManageOrgSubscriptions := middleware.AdminRole(s.Global, adminspec.AdminRoleManageOrgSubscriptions)` → `AdminRoleManageOrgPlans`
- Route `"POST /admin/org-subscriptions/list"` → `"POST /admin/org-plan/list"`
- Route `"POST /admin/org-subscriptions/set-tier"` → `"POST /admin/org-plan/set"`
- Handler calls: `admin.ListOrgSubscriptions(s)` → `admin.ListOrgPlans(s)`; `admin.SetOrgTier(s)` → `admin.SetOrgPlan(s)`
- Middleware var names: `adminRoleViewOrgSubscriptions` → `adminRoleViewOrgPlans`; `adminRoleManageOrgSubscriptions` → `adminRoleManageOrgPlans`

### Step 9: complete-signup.go

File: `api-server/handlers/org/complete-signup.go`

- `CurrentTierID: "free"` → `CurrentPlanID: "free"`
- `FromTierID: pgtype.Text{Valid: false}` → `FromPlanID: pgtype.Text{Valid: false}`
- `ToTierID: "free"` → `ToPlanID: "free"`
- `s.Global.UpsertOrgSubscription(ctx, ...)` → `s.Global.UpsertOrgPlan(ctx, ...)`
- `s.Global.InsertOrgSubscriptionHistory(ctx, ...)` → `s.Global.InsertOrgPlanHistory(ctx, ...)`

### Step 10: Build backend

Run: `cd api-server && go build ./...`
Fix any compilation errors before proceeding.

### Step 11: org-ui changes

**New file: `src/pages/Plan/PlanPage.tsx`** (move + rename from `src/pages/Subscription/SubscriptionPage.tsx`)

- Export `PlanPage` function (was `SubscriptionPage`)
- Update `useTranslation("subscription")` → `useTranslation("plan")`
- API calls:
  - `/org/org-subscriptions/get` → `/org/org-plan/get`
  - `/org/org-subscriptions/list-tiers` → `/org/org-plan/list-plans`
  - `/org/org-subscriptions/self-upgrade` → `/org/org-plan/upgrade`
- Type imports: `OrgSubscription` → `OrgPlan`; `OrgTier` → `Plan`; `ListOrgTiersResponse` → `ListPlansResponse`; `SelfUpgradeOrgSubscriptionRequest` → `UpgradeOrgPlanRequest`
- Field references: `tier.tier_id` → `plan.plan_id`; `subscription.current_tier` → `subscription.current_plan`; `tier.self_upgradeable` → `plan.self_upgradeable` (unchanged); etc.
- `data.tiers` → `data.plans` (response field)
- `req: SelfUpgradeOrgSubscriptionRequest { tier_id: tier.tier_id }` → `req: UpgradeOrgPlanRequest { plan_id: plan.plan_id }`
- Remove old `src/pages/Subscription/SubscriptionPage.tsx`

**Update `src/App.tsx`**

- Import: `SubscriptionPage` → `PlanPage` from `./pages/Plan/PlanPage`
- Route path: `/settings/subscription` → `/settings/plan`

**Update `src/pages/DashboardPage.tsx`**

- `hasSubscriptionAccess` → `hasPlanAccess`
- Role check strings: `"org:view_subscription"` → `"org:view_plan"`; `"org:manage_subscription"` → `"org:manage_plan"`
- Link: `/settings/subscription` → `/settings/plan`
- i18n: `t("subscription.title")` → `t("plan.title")`; `t("subscription.description")` → `t("plan.description")`

**Update `src/pages/Marketplace/CreateListingPage.tsx`**

- Link `/settings/subscription` → `/settings/plan`
- API call `/org/org-subscriptions/get` → `/org/org-plan/get`
- Type: `OrgSubscription` → `OrgPlan`
- Field: `subscription?.current_tier.marketplace_listings_cap` → `subscription?.current_plan.marketplace_listings_cap`
- Field: `subscription?.current_tier.tier_id` → `subscription?.current_plan.plan_id`

**Update `src/pages/Marketplace/MyListingsPage.tsx`**

- Link `/settings/subscription` → `/settings/plan`
- API call `/org/org-subscriptions/get` → `/org/org-plan/get`
- Type: `OrgSubscription` → `OrgPlan`
- Field: `subscription?.current_tier.*` → `subscription?.current_plan.*`
- Field: `subscription?.current_tier.tier_id` → `subscription?.current_plan.plan_id`

**Update `src/pages/Marketplace/MarketplaceListingPage.tsx`**

- Link `/settings/subscription` → `/settings/plan`
- API call `/org/org-subscriptions/get` → `/org/org-plan/get`
- Type: `OrgSubscription` → `OrgPlan`
- Field: `subscription?.current_tier.*` → `subscription?.current_plan.*`

**Update `src/components/QuotaExceededModal.tsx`**

- Check if it reads `tier_id` from payload → update to `plan_id`

**Update i18n locale files:**

- Rename `src/locales/en-US/subscription.json` → `src/locales/en-US/plan.json` (keep keys but update display text to say "Vetchium Plan")
- Rename `src/locales/de-DE/subscription.json` → `src/locales/de-DE/plan.json`
- Rename `src/locales/ta-IN/subscription.json` → `src/locales/ta-IN/plan.json`
- Update `src/i18n.ts`: change import names and namespace registration from `subscription`/`enUSSubscription` etc. → `plan`/`enUSPlan` etc.
- Update `src/locales/en-US/common.json`: rename `"subscription"` key to `"plan"`; update text
- Update `src/locales/de-DE/common.json`: same
- Update `src/locales/ta-IN/common.json`: same
- Update marketplace locale files (all 3 languages): `{{tier}}` → `{{plan}}` in template strings; `tier` parameter → `plan` parameter in all quota messages

**Update marketplace pages to pass `plan` instead of `tier` to t() calls:**

- `CreateListingPage.tsx`: `t("create.quotaBanner", { tier: ..., cap: ... })` → `t("create.quotaBanner", { plan: ..., cap: ... })`
- `MyListingsPage.tsx`: `t("listings.quotaTooltip", { tier: ..., cap: ... })` etc. → `{ plan: ..., cap: ... }`
- `MarketplaceListingPage.tsx`: same for quota tooltip strings

**Update marketplace locale files (en-US, de-DE, ta-IN):**

- `"quotaExceeded"`: `{{tier}}` → `{{plan}}`
- `"listings.quotaTooltip"`: `{{tier}}` → `{{plan}}`
- `"listings.quotaTooltipZero"`: `{{tier}}` → `{{plan}}`
- `"create.quotaBanner"`: `{{tier}}` → `{{plan}}`
- `"listing.publishQuotaTooltip"`: `{{tier}}` → `{{plan}}`

**Build org-ui:**
Run: `cd org-ui && bun run build`
Fix any errors.

### Step 12: admin-ui changes

**New file: `src/pages/OrgPlans/OrgPlansPage.tsx`** (move + rename from `src/pages/OrgSubscriptions/OrgSubscriptionsPage.tsx`)

- Export `OrgPlansPage` (was `OrgSubscriptionsPage`)
- `useTranslation("orgSubscriptions")` → `useTranslation("orgPlans")`
- API calls:
  - `/admin/org-subscriptions/list` → `/admin/org-plan/list`
  - `/admin/org-subscriptions/set-tier` → `/admin/org-plan/set`
- Type imports: `OrgSubscription` → `OrgPlan`; `AdminListOrgSubscriptionsRequest` → `AdminListOrgPlansRequest`; `AdminSetOrgTierRequest` → `AdminSetOrgPlanRequest`
- Field: `item.current_tier.tier_id` → `item.current_plan.plan_id`
- Field: `req.tier_id` → `req.plan_id` in set-plan request
- `filter_tier_id` → `filter_plan_id`
- Remove old `src/pages/OrgSubscriptions/OrgSubscriptionsPage.tsx`

**Update `src/App.tsx`**

- Import: `OrgSubscriptionsPage` → `OrgPlansPage` from `./pages/OrgPlans/OrgPlansPage`
- Route: `/org-subscriptions` → `/org-plans`

**Update `src/pages/DashboardPage.tsx`**

- `canViewOrgSubscriptions` → `canViewOrgPlans`
- Role string: `"admin:view_org_subscriptions"` → `"admin:view_org_plans"`
- Link: `/org-subscriptions` → `/org-plans`
- i18n: `orgSubscriptions.*` → `orgPlans.*`

**Update i18n:**

- Rename `src/locales/en-US/org-subscriptions.json` → `src/locales/en-US/org-plans.json`
- Rename `src/locales/de-DE/org-subscriptions.json` → `src/locales/de-DE/org-plans.json`
- Rename `src/locales/ta-IN/org-subscriptions.json` → `src/locales/ta-IN/org-plans.json`
- Update `src/i18n.ts`: imports and namespace `orgSubscriptions` → `orgPlans`

**Build admin-ui:**
Run: `cd admin-ui && bun run build`
Fix any errors.

### Step 13: Playwright lib files

**Update `playwright/lib/db.ts`**

- SQL: `org_subscriptions` → `org_plans`; `current_tier_id` → `current_plan_id`
- SQL: `org_subscription_history` → `org_plan_history`
- Function `setOrgTier(orgId, tierId)` → `setOrgPlan(orgId, planId)`: rename params and update SQL
- Update all export/usage of `setOrgTier` → `setOrgPlan`
- Comments: "free tier" → "free plan"

**Update `playwright/lib/org-api-client.ts`**

- Import: `ListOrgTiersResponse` → `ListPlansResponse`; `OrgSubscription` → `OrgPlan`; `GetMyOrgSubscriptionRequest` → `GetMyOrgPlanRequest`; `SelfUpgradeOrgSubscriptionRequest` → `UpgradeOrgPlanRequest`
- Method `listOrgTiers` → `listPlans`; URL `/org/org-subscriptions/list-tiers` → `/org/org-plan/list-plans`
- Method `getMyOrgSubscription` → `getMyOrgPlan`; URL `/org/org-subscriptions/get` → `/org/org-plan/get`
- Method `selfUpgradeOrgSubscription` (and `selfUpgradeOrgSubscriptionRaw`) → `upgradeOrgPlan` / `upgradeOrgPlanRaw`; URL `/org/org-subscriptions/self-upgrade` → `/org/org-plan/upgrade`

**Update `playwright/lib/admin-api-client.ts`**

- Import: `OrgSubscription as AdminSetOrgTierResponse` → `OrgPlan as AdminSetOrgPlanResponse`
- Import: `AdminSetOrgTierRequest` → `AdminSetOrgPlanRequest`
- Import: `AdminListOrgSubscriptionsRequest` → `AdminListOrgPlansRequest`; `AdminListOrgSubscriptionsResponse` → `AdminListOrgPlansResponse`
- Method `setOrgTier` → `setOrgPlan`; `setOrgTierRaw` → `setOrgPlanRaw`; URL `/admin/org-subscriptions/set-tier` → `/admin/org-plan/set`
- Method `listOrgSubscriptions` → `listOrgPlans`; `listOrgSubscriptionsRaw` → `listOrgPlansRaw`; URL `/admin/org-subscriptions/list` → `/admin/org-plan/list`
- Update `FilterTierID` → `FilterPlanID` in request params

### Step 14: Playwright test files

**Rename + update `tests/api/admin/org-subscription.spec.ts` → `tests/api/admin/org-plan.spec.ts`**

- All imports: renamed types
- All API calls: new URLs
- All `tier_id` → `plan_id` field assertions
- All `current_tier` → `current_plan` field assertions
- All `filter_tier_id` → `filter_plan_id`
- describe/test string updates

**Rename + update `tests/api/org/org-subscription.spec.ts` → `tests/api/org/org-plan.spec.ts`**

- Same field/URL updates
- `tiers` → `plans` in list response assertions

**Rename + update `tests/ui/admin/org-subscriptions.spec.ts` → `tests/ui/admin/org-plans.spec.ts`**

- URL `/org-subscriptions` → `/org-plans`
- UI text assertions updated to "Vetchium Plan" etc.

**Rename + update `tests/ui/org/subscription.spec.ts` → `tests/ui/org/org-plan.spec.ts`**

- URL `/settings/subscription` → `/settings/plan`
- UI text assertions updated

**Update `tests/api/org/suborgs.spec.ts`**

- Import: `setOrgTier` → `setOrgPlan`
- All calls: `setOrgTier(orgId, "silver")` → `setOrgPlan(orgId, "silver")`

**Update `tests/api/org/marketplace.spec.ts`** (if it uses setOrgTier)

- Import and usage: `setOrgTier` → `setOrgPlan`

**Check all other test files for `setOrgTier` usage:**
Run: `grep -r "setOrgTier\|org-subscriptions\|org_subscriptions\|tier_id\|OrgTier\|OrgSubscription" playwright/tests/ --include="*.ts"`
Update any files found.

### Step 15: Run tests

```bash
cd playwright && npm test
```

Ensure all tests pass with zero skips.

---

## Files NOT to touch

- `marketplace_subscription_index` table and queries
- `/org/marketplace/subscription/*` routes and handlers
- `org:view_subscriptions` / `org:manage_subscriptions` roles
- `OrgRoleViewSubscriptions` / `OrgRoleManageSubscriptions` constants
- Any file with `MarketplaceSubscription` type
- `admin:view_marketplace` / `admin:manage_marketplace` roles
