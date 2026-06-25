# Spec 17 — Signup Region Segregation & Per-Region Pricing

Status: **DRAFT** (complete spec — requirements + design)
Authors: @psankar
Last updated: 2026-06-25
Dependencies: Spec 16 (Org Plans), Global `available_regions`, Org + Hub signup flows

> A single, complete design doc (Anthropic-style): **Summary → Motivation → Goals/Non-Goals →
> Current State → Decisions → Plan & Pricing Definitions → Detailed Design (data, API, backend,
> frontend) → Requirements/Tests → Rollout → Open Questions.** It is implementable end-to-end as
> written; every change obeys `CLAUDE.md`.

---

## 1. Summary

Vetchium runs one isolated DB + object store **per region**. We will (a) keep showing the
**same plan** at a **different price and currency per region**, sourced from **frontend config**
(no DB, no payment yet); and (b) give hub users a **Free/Pro plan** whose Pro tier is
server-enforced and framed as **supporting this open-source project**. Region selection at signup
already works server-side; this spec surfaces pricing for the chosen region and adds the hub plan
system + Pro gating.

The split that drives the whole design: **prices are display-only marketing data → frontend
config; plan membership + capability enforcement must be tamper-proof → backend.** Prices touch
no database; the backend changes are entirely the hub plan system.

## 2. Motivation

- The same plan must cost, say, €500/yr in deu1, ₹2,000/yr in ind1, a few dollars in usa1.
- Hub users have no plan today; we want a Pro tier that funds development and unlocks richer
  features (profile picture now, posts later) while keeping job-search basics free.
- Adding a region later should be **config**, not a code change.

## 3. Goals

- Region chosen at signup (any serving API server) → all data in that region. _(Already true;
  guarded here.)_
- Signup + plan pages show **that region's prices in that region's currency**, monthly & annual,
  from frontend config, with an annual-savings nudge.
- Hub Free/Pro with real, server-side gating; Free is generous (unlimited applies/connections).
- Pricing page communicates that Pro supports the open-source project.
- Adding a region = backend region row + a frontend currency/price entry; no logic change.

## 4. Non-Goals

- **No payment collection** (display-only; "switch plan" just updates the record). Real billing
  is a future gateway spec; prices move server-side then, not now.
- **No prices in the DB, no pricing API, no admin pricing UI.**
- **No cross-region migration** (`home_region` immutable → currency fixed per account).
- **No multi-currency per region; no FX/auto-conversion.**

## 5. Current State (verified in code, 2026-06-25)

- Region selection at signup works: `org.OrgInitSignupRequest` / `hub.CompleteSignupRequest`
  carry `home_region`, validated against `available_regions`; data routed with no proxy. Hub
  signup UI already renders a region `<Select>` from `POST /global/get-regions`.
- `available_regions` (global): `region_code`, `region_name`, `is_active`. ind1/usa1/deu1 active,
  sgp1 inactive. No currency — and none needed (frontend config).
- Org plans (Free/Silver/Gold/Enterprise) exist with caps + `self_upgradeable`. No money — correct.
- Hub users have no plan; roles only.
- `POST /hub/upload-profile-picture` exists, open to all → becomes Pro-gated.
- Posts not implemented → Pro gate applies when built.
- Regional `hub_users` table holds hub mutable data (status, preferred_language, …).

## 6. Decisions (finalized in review)

1. **Hub Free is generous:** unlimited applications & connections, no counters (§Goals).
2. **Pro = support tier:** unlocks profile picture (now), posts (later), future features; page
   says Pro funds the project.
3. **Currency per region in frontend config:** `region_code → {currency_code, symbol, exponent}`
   (ind1→INR ₹, usa1→USD $, deu1→EUR €, sgp1→SGD S$). Amounts in minor units, never floats.
4. **Prices = frontend config, not DB** (no price table/endpoint/admin UI). Backend touched only
   for the hub plan system (membership + enforcement); a frontend-only Pro flag would be
   bypassable, so plan **state/enforcement** is server-side, prices are not.
5. **Monthly + annual with a "save N%" nudge.** Free → "Free", Enterprise → "Contact us" inline.
6. **Hub plans self-upgradeable both ways, display-only.** Org switching unchanged.
7. **Free is the signup default;** signup pricing is informational (no plan field in signup).
8. **Prices are set per region on their own merits** (§8): an accessible individual Pro tier and
   purchasing-power-adjusted business tiers; annual = pay for 10 months (~17% off).

## 7. Plan capability matrix (server-enforced)

| Capability                         | Hub Free | Hub Pro |
| ---------------------------------- | :------: | :-----: |
| Read posts / browse openings       |    ✅    |   ✅    |
| Apply to openings (**unlimited**)  |    ✅    |   ✅    |
| Connections (**unlimited**)        |    ✅    |   ✅    |
| Add a profile picture              |    ❌    |   ✅    |
| Post messages _(when implemented)_ |    ❌    |   ✅    |
| Self-upgrade / downgrade           |    ✅    |   ✅    |

Org plan capability caps are unchanged from Spec 16 (NULL = unlimited):

| Cap                    | Free | Silver |   Gold    |  Enterprise  |
| ---------------------- | :--: | :----: | :-------: | :----------: |
| Org users              |  5   |   25   |    100    |  Unlimited   |
| Verified domains       |  2   |   5    | Unlimited |  Unlimited   |
| Sub-orgs               |  0   |   3    |    10     |  Unlimited   |
| Marketplace listings   |  0   |   5    |    20     |  Unlimited   |
| Audit retention (days) |  30  |  365   |   1095    |  Unlimited   |
| MCP access †           |  ❌  |   ❌   |    ✅     |      ✅      |
| Self-upgradeable       |  —   |   ✅   |    ✅     | Admin-only\* |

\*Enterprise is admin-assigned ("Contact us"); Free→Silver and Silver/Gold self-upgrade as today.
† **MCP access** (programmatic Model-Context-Protocol integration) is a **Gold-and-up** feature,
shown as **"Coming soon"** until implemented; listing it now signals the Gold value prop. It is a
marketing/display flag only in this spec — no MCP server is built here.

**Org Enterprise — "Coming soon" section.** The Enterprise plan card shows a dedicated
**"Coming soon"** block for features under consideration / custom-negotiated, currently:

- MCP access (programmatic API integration)
- _More to be added (e.g. SSO/SAML, dedicated support, custom data residency) — placeholder._

This block is display-only i18n copy on the Enterprise card; none of it is enforced or built in
this spec.

## 8. Pricing (recommended, frontend config — accept/edit)

Prices are set per region on their own merits, not derived from any competitor. Principles:
**Hub Pro is an accessible "support the project" individual tier** (deliberately cheap);
**Org Silver/Gold are business tiers, purchasing-power-adjusted** so they feel proportionate in
each market (lower in INR terms, higher in USD/EUR); **annual = pay for 10 months (~17% off,
"2 months free")** everywhere for a consistent nudge. Amounts are round, locally-natural numbers.
These are **recommendations to accept or edit** before implementation.

**Hub Pro** — individual supporter tier

| Region     | Monthly | Annual | minor units (mo / yr) | save |
| ---------- | ------- | ------ | --------------------- | ---- |
| ind1 (INR) | ₹399    | ₹3,990 | 39900 / 399000        | 17%  |
| usa1 (USD) | $5      | $50    | 500 / 5000            | 17%  |
| deu1 (EUR) | €5      | €50    | 500 / 5000            | 17%  |

**Org Silver** — small/early hiring teams

| Region     | Monthly | Annual  | minor units (mo / yr) | save |
| ---------- | ------- | ------- | --------------------- | ---- |
| ind1 (INR) | ₹4,999  | ₹49,990 | 499900 / 4999000      | 17%  |
| usa1 (USD) | $49     | $490    | 4900 / 49000          | 17%  |
| deu1 (EUR) | €49     | €490    | 4900 / 49000          | 17%  |

**Org Gold** — heavy operators / staffing firms (incl. **MCP access**, coming soon)

| Region     | Monthly | Annual   | minor units (mo / yr) | save |
| ---------- | ------- | -------- | --------------------- | ---- |
| ind1 (INR) | ₹14,999 | ₹149,990 | 1499900 / 14999000    | 17%  |
| usa1 (USD) | $149    | $1,490   | 14900 / 149000        | 17%  |
| deu1 (EUR) | €149    | €1,490   | 14900 / 149000        | 17%  |

_Hub Free / Org Free → "Free". Org Enterprise → "Contact us". `save` = (monthly×12 − annual) ÷
(monthly×12); annual is exactly monthly × 10 → "2 months free"._

**All amounts are tax-exclusive.** Every displayed price carries a **"+ applicable taxes"** note
(GST in India, VAT in the EU, sales tax in the US — collected at the future payment-gateway stage,
not computed here). The UI shows e.g. "₹399 / mo + applicable taxes"; the config stores the
net amount only. This note is translated i18n copy (en-US/de-DE/ta-IN).

## 9. Detailed Design

### 9.1 Frontend pricing config (the entire "pricing" surface)

- **Shared currency map** in the spec package so all portals agree:
  `api-schema/common/currency.ts` →
  `REGION_CURRENCY: Record<RegionCode, { currency_code: string; symbol: string; exponent: number }>`.
- **Per-portal price config** (prices only shown where relevant): `hub-ui/src/config/pricing.ts`
  (Hub Pro) and `org-ui/src/config/pricing.ts` (Silver/Gold). Shape:
  `Record<RegionCode, Record<PlanId, { monthly_minor: number; annual_minor: number } | "free" | "contact">>`,
  populated from §8 (minor units).
- **`formatCurrency(amountMinor, regionCode, locale)`** util in `{hub,org}-ui/src/utils/currencyFormat.ts`
  (mirrors `dateFormat.ts`): looks up `REGION_CURRENCY`, divides by `10^exponent`, formats via
  `Intl.NumberFormat(locale, { style: "currency", currency })`.
- **Savings badge** computed in-component: `save = round(1 − annual/(monthly*12))`.
- No backend call, no types beyond the shared currency/region constants.

### 9.2 Hub plan system (the only backend work) — Regional DB

Plan membership is mutable hub data → **regional DB** (one regional round-trip for membership +
capabilities; no global hit added to the profile-picture path).

```sql
-- Regional DB — capability definitions (seeded, identical per region)
CREATE TABLE hub_plans (
    plan_id                     TEXT        PRIMARY KEY,
    display_order               INT         NOT NULL UNIQUE,
    can_upload_profile_picture  BOOLEAN     NOT NULL DEFAULT FALSE,
    can_post_messages           BOOLEAN     NOT NULL DEFAULT FALSE,
    self_upgradeable            BOOLEAN     NOT NULL DEFAULT TRUE,
    status                      TEXT        NOT NULL CHECK (status IN ('active','retired')) DEFAULT 'active',
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO hub_plans (plan_id, display_order, can_upload_profile_picture, can_post_messages, self_upgradeable) VALUES
    ('free', 1, FALSE, FALSE, TRUE),
    ('pro',  2, TRUE,  TRUE,  TRUE);

-- Membership: add to the EXISTING regional hub_users table
ALTER TABLE hub_users
    ADD COLUMN plan_id TEXT NOT NULL DEFAULT 'free' REFERENCES hub_plans(plan_id);

-- Switch history (audit trail of plan changes)
CREATE TABLE hub_user_plan_history (
    history_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    hub_user_global_id  UUID        NOT NULL,
    from_plan_id        TEXT,
    to_plan_id          TEXT        NOT NULL,
    changed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason              TEXT        NOT NULL DEFAULT ''
);
```

> Edit `api-server/db/migrations/regional/00000000000001_initial_schema.sql` in place (pre-prod,
> no new migration files). No new perf indexes.

**sqlc queries** (`api-server/db/regional/queries/hub_plans.sql`): `ListHubPlans`,
`GetHubUserPlanWithCaps` (join `hub_users` × `hub_plans` in one round-trip),
`SwitchHubUserPlan` (UPDATE `hub_users.plan_id … RETURNING`), `InsertHubPlanHistory`,
`GetHubPlan` (target validation).

### 9.3 API contract

All types in `api-schema/hub/plans.tsp` + hand-synced `.ts`/`.go`, imported everywhere.

```typespec
// api-schema/hub/plans.tsp
model HubPlan {
  plan_id: string;
  display_order: int32;
  can_upload_profile_picture: boolean;
  can_post_messages: boolean;
  self_upgradeable: boolean;
}
model ListHubPlansResponse { plans: HubPlan[]; }   // never null → []
model SwitchHubPlanRequest { plan_id: string; }
model HubPlanResponse { plan_id: string; can_upload_profile_picture: boolean; can_post_messages: boolean; }

@route("/hub/list-plans") @post op listHubPlans(): OkResponse<ListHubPlansResponse> | UnauthorizedResponse;
@route("/hub/switch-plan") @post op switchHubPlan(...SwitchHubPlanRequest):
  OkResponse<HubPlanResponse> | BadRequestResponse | UnauthorizedResponse | NotFoundResponse | UnprocessableResponse;
```

- **Extend `GET /hub/myinfo`** response with `plan_id` + capability booleans (one extra regional
  read folded into the existing myinfo query — no new global round-trip).

### 9.4 Backend handlers

| Method | Path                          | Handler                         | Auth    | Notes                                            |
| ------ | ----------------------------- | ------------------------------- | ------- | ------------------------------------------------ |
| POST   | `/hub/list-plans`             | `handlers/hub/plans-list.go`    | HubAuth | Reads `hub_plans` (active), returns `[]HubPlan`  |
| POST   | `/hub/switch-plan`            | `handlers/hub/plans-switch.go`  | HubAuth | Validate target (exists/active/self_upgradeable) |
| GET    | `/hub/myinfo`                 | `handlers/hub/myinfo.go` (edit) | HubAuth | Add `plan_id` + caps                             |
| POST   | `/hub/upload-profile-picture` | existing (edit)                 | HubAuth | **Pro gate**: load caps; `!can_upload…` → 403    |

- **switch-plan**: decode → validate → `WithRegionalTx`: `GetHubPlan(target)` (404 if missing /
  422 if not `self_upgradeable` or retired) → `SwitchHubUserPlan` → `InsertHubPlanHistory` →
  `InsertAuditLog` (`hub.switch_plan`, `event_data` = `{from, to}`) → respond 200. Audit write is
  **inside** the same tx.
- **upload-profile-picture**: after auth, `GetHubUserPlanWithCaps(userID)`; if
  `!can_upload_profile_picture` → 403 (authenticated but forbidden by plan) and store nothing.
- **complete-signup**: regional `CreateHubUser` already runs in a tx; `plan_id` defaults to
  `'free'` via the column default (no code change required, but assert it in tests).

**Audit events** (regional `audit_logs`): `hub.switch_plan` (actor = hub user, data
`{from_plan_id, to_plan_id}`; no emails).

### 9.5 Frontend

| Portal | Route / file                                     | What                                                  |
| ------ | ------------------------------------------------ | ----------------------------------------------------- |
| hub-ui | `forms/SignupCompleteForm.tsx` (edit)            | Pricing table for selected region + "support us" note |
| hub-ui | `pages/Settings/PlanPage.tsx` → `/settings/plan` | Current plan, Free/Pro cards, prices, Switch button   |
| hub-ui | `config/pricing.ts`, `utils/currencyFormat.ts`   | Hub Pro price config + formatter                      |
| org-ui | `forms/SignupForm.tsx` (edit)                    | Org pricing table (Silver/Gold/Enterprise) for region |
| org-ui | `config/pricing.ts`, `utils/currencyFormat.ts`   | Org price config + formatter                          |

- Standard page layout (maxWidth 1200, back button, Title level 2) for `/settings/plan`.
- Switch button calls `POST /hub/switch-plan`; refetch `myinfo` after; gate the profile-picture
  upload UI on `myinfo.can_upload_profile_picture` (defence-in-depth; backend still enforces).
- **i18n** keys (en-US/de-DE/ta-IN) incl. the "Pro supports this open-source project" copy,
  "save N%", "+ applicable taxes", "Contact us", plan names/descriptions (names live in i18n,
  not the DB).

### 9.6 RBAC

No new roles. Hub plan view/switch act on the caller's own account → authentication suffices.
No admin surface. (Org plan RBAC unchanged.)

## 10. Requirements → Test Matrix

Playwright API tests (`playwright/tests/api/hub/plans.spec.ts`, `upload-profile-picture.spec.ts`)

- component tests for pricing display. Types imported from `api-schema/`.

| #   | Scenario                                                                  | Expected            |
| --- | ------------------------------------------------------------------------- | ------------------- |
| 1   | Signup `home_region=X` (any server) → rows in X, token X-prefixed         | success; data in X  |
| 1b  | Signup missing/invalid/inactive `home_region`                             | 400                 |
| 2   | New hub user → `plan_id='free'`; `myinfo` shows free + caps               | 200, free           |
| 3   | Free user `upload-profile-picture`                                        | 403, nothing stored |
| 4   | Pro user `upload-profile-picture`                                         | 201/200, stored     |
| 5   | Free user applies to many openings / many connections                     | all succeed         |
| 6   | `switch-plan` free→pro (self_upgradeable)                                 | 200, caps updated   |
| 7   | `switch-plan` pro→free                                                    | 200                 |
| 8   | `switch-plan` unknown plan / retired / non-self_upgradeable               | 404 / 422 / 422     |
| 9   | `switch-plan` unauthenticated                                             | 401                 |
| 10  | Audit `hub.switch_plan` written on success; none on 4xx                   | asserted            |
| 11  | Pricing component: region X → X's currency & amounts; Free/Contact labels | rendered            |
| 12  | Annual nudge shows "save N%" from config                                  | rendered            |
| 13  | Add a region: backend `available_regions` row + frontend config entry     | appears, no logic Δ |

## 11. Rollout

1. Regional migration: `hub_plans` (+seed), `hub_users.plan_id`, `hub_user_plan_history`.
2. sqlc generate; API types (`hub/plans.tsp` + `.ts`/`.go`); `tsp compile`.
3. Backend: list/switch handlers, myinfo edit, profile-picture gate; register routes.
4. Frontend: currency map + per-portal price config + `formatCurrency`; signup tables; hub
   `/settings/plan`; i18n.
5. Tests (table §10). `bun run format` + `lint` before commit.
6. Docs: `docs/runbooks/add-new-region.md` gains "frontend currency + price config" step;
   distil into `docs/design/` post-ship; update `MEMORY.md`.

No data migration needed (pre-production). `plan_id` default `'free'` backfills existing rows.

## 12. Open Questions

1. **Confirm/edit the recommended prices** in §8 (per plan, per region, monthly + annual).
2. **Pro feature list** beyond picture + posts — add more later or keep minimal?
3. **Plan names/descriptions** in i18n (current choice) vs. a DB translations table like org
   plans — i18n keeps the DB out of display strings; flagging for consistency review.
