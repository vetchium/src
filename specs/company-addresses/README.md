## Stage 1: Requirements

Status: DRAFT
Authors: @psankar
Dependencies: none
Dependents: job-openings (on_site/hybrid openings reference an org address)
Future specs: none

### Overview

Company Addresses let OrgUsers maintain a named address book for their organisation. Each address has a human-readable title, a full postal address, and optional map URLs (e.g. Google Maps, Apple Maps, OpenStreetMap). Addresses are used as the location reference when creating on-site or hybrid Job Openings, replacing free-form city/country text.

Portals affected: Org portal. All write operations are initiated by OrgUsers.

### Acceptance Criteria

- [ ] OrgUser with `org:manage_addresses` can add a new address; it starts in `active` status
- [ ] Required fields: title, address_line1, city, country
- [ ] Optional fields: address_line2, state, postal_code, map_urls (array of URLs, max 5 entries)
- [ ] OrgUser with `org:manage_addresses` can update any field on an address
- [ ] OrgUser with `org:manage_addresses` can disable an address → `disabled` status
- [ ] OrgUser with `org:manage_addresses` can re-enable a disabled address → `active` status
- [ ] Disabling an address that is referenced by one or more `draft` openings is allowed; those openings will fail validation on submit until the address is replaced or re-enabled
- [ ] Disabling an address that is referenced by a `pending_review`, `published`, or `paused` opening is blocked → 422 (opening is still live or can be unpaused)
- [ ] OrgUser with `org:view_addresses` can list and view addresses (read-only); write operations require `org:manage_addresses`
- [ ] Address list supports filtering by status (`active` / `disabled` / all) and keyset pagination
- [ ] Audit log written inside the same transaction for every write operation
- [ ] New roles `org:view_addresses` and `org:manage_addresses` defined in roles.ts, roles.go, and initial_schema.sql

### Field Constraints

| Field         | Required | Max length | Notes                                                |
| ------------- | -------- | ---------- | ---------------------------------------------------- |
| title         | yes      | 100 chars  | Short internal label, e.g. "HQ", "London Office"     |
| address_line1 | yes      | 200 chars  | Street address                                       |
| address_line2 | no       | 200 chars  | Floor, suite, building name, etc.                    |
| city          | yes      | 100 chars  |                                                      |
| state         | no       | 100 chars  | State, province, or region                           |
| postal_code   | no       | 20 chars   |                                                      |
| country       | yes      | 100 chars  | Full country name or ISO 3166-1 alpha-2 code         |
| map_urls      | no       | 5 entries  | Each URL max 500 chars; free-form (any map provider) |

### User-Facing Screens

**Screen: Address List (Org)**

Portal: org-ui | Route: `/settings/addresses`

Header: Back to Dashboard button | "Company Addresses" title (h2) | "Add Address" button (right)

Filter: Status dropdown — All / Active / Disabled

| Title | Address | City | Country | Status | Created At | Actions                    |
| ----- | ------- | ---- | ------- | ------ | ---------- | -------------------------- |
| …     | …       | …    | …       | …      | …          | Edit · Disable / Re-enable |

**Screen: Add / Edit Address**

Portal: org-ui | Route: `/settings/addresses/new` (add) and `/settings/addresses/:address_id/edit` (edit)

| Field          | Type                | Constraints                                   |
| -------------- | ------------------- | --------------------------------------------- |
| Title          | text                | required, max 100 chars                       |
| Address Line 1 | text                | required, max 200 chars                       |
| Address Line 2 | text                | optional, max 200 chars                       |
| City           | text                | required, max 100 chars                       |
| State          | text                | optional, max 100 chars                       |
| Postal Code    | text                | optional, max 20 chars                        |
| Country        | text                | required, max 100 chars                       |
| Map URLs       | list of text inputs | optional, up to 5 entries, each max 500 chars |

Submit button: "Save Address"

### API Surface

| Endpoint                    | Portal | Who calls it               | What it does                                         |
| --------------------------- | ------ | -------------------------- | ---------------------------------------------------- |
| `POST /org/create-address`  | org    | OrgUser (manage_addresses) | Creates a new address in `active` status             |
| `POST /org/update-address`  | org    | OrgUser (manage_addresses) | Updates all fields on an address                     |
| `POST /org/disable-address` | org    | OrgUser (manage_addresses) | Moves `active` → `disabled`; blocked if in-use (422) |
| `POST /org/enable-address`  | org    | OrgUser (manage_addresses) | Moves `disabled` → `active`                          |
| `POST /org/list-addresses`  | org    | OrgUser (view_addresses)   | Paginates addresses; optional status filter          |
| `POST /org/get-address`     | org    | OrgUser (view_addresses)   | Gets a single address by ID                          |

---

## Stage 2: Implementation Plan

Status: DRAFT
Authors: @psankar

### API Contract

TypeSpec definitions in `specs/typespec/org/company-addresses.tsp` with matching `.ts` and `.go` files.

**`specs/typespec/org/company-addresses.tsp`:**

```typespec
import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";
import "../common/common.tsp";

using TypeSpec.Http;
namespace Vetchium;

model CreateAddressRequest {
  title: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state?: string;
  postal_code?: string;
  country: string;
  map_urls?: string[];
}

model UpdateAddressRequest {
  address_id: string;
  title: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state?: string;
  postal_code?: string;
  country: string;
  map_urls?: string[];
}

model DisableAddressRequest { address_id: string; }
model EnableAddressRequest  { address_id: string; }
model GetAddressRequest     { address_id: string; }

model ListAddressesRequest {
  filter_status?: string;
  pagination_key?: string;
  limit?: int32;
}

model OrgAddress {
  address_id:    string;
  title:         string;
  address_line1: string;
  address_line2?: string;
  city:          string;
  state?:        string;
  postal_code?:  string;
  country:       string;
  map_urls:      string[];
  status:        string;
  created_at:    string;
}

model ListAddressesResponse {
  addresses:          OrgAddress[];
  next_pagination_key?: string;
}

@route("/org")
interface OrgAddresses {
  @route("/create-address")  @post createAddress (...CreateAddressRequest) : OrgAddress | BadRequestResponse;
  @route("/update-address")  @post updateAddress (...UpdateAddressRequest) : OrgAddress | BadRequestResponse | NotFoundResponse;
  @route("/disable-address") @post disableAddress(...DisableAddressRequest): OrgAddress | NotFoundResponse | UnprocessableEntityResponse;
  @route("/enable-address")  @post enableAddress (...EnableAddressRequest) : OrgAddress | NotFoundResponse | UnprocessableEntityResponse;
  @route("/get-address")     @post getAddress    (...GetAddressRequest)    : OrgAddress | NotFoundResponse;
  @route("/list-addresses")  @post listAddresses (...ListAddressesRequest) : ListAddressesResponse | BadRequestResponse;
}
```

**`specs/typespec/org/company-addresses.ts`** — hand-written TypeScript types with validators:

```typescript
import { type ValidationError, newValidationError } from "../common/common";

const ADDRESS_TITLE_MAX = 100;
const ADDRESS_LINE1_MAX = 200;
const ADDRESS_LINE2_MAX = 200;
const ADDRESS_CITY_MAX  = 100;
const ADDRESS_STATE_MAX = 100;
const ADDRESS_POSTAL_CODE_MAX = 20;
const ADDRESS_COUNTRY_MAX = 100;
const ADDRESS_MAP_URL_MAX = 500;
const ADDRESS_MAP_URLS_MAX_ENTRIES = 5;

export type OrgAddressStatus = "active" | "disabled";

export interface OrgAddress {
  address_id:    string;
  title:         string;
  address_line1: string;
  address_line2?: string;
  city:          string;
  state?:        string;
  postal_code?:  string;
  country:       string;
  map_urls:      string[];
  status:        OrgAddressStatus;
  created_at:    string;
}

export interface CreateAddressRequest {
  title:         string;
  address_line1: string;
  address_line2?: string;
  city:          string;
  state?:        string;
  postal_code?:  string;
  country:       string;
  map_urls?:     string[];
}

export function validateCreateAddressRequest(r: CreateAddressRequest): ValidationError[] { ... }

export interface UpdateAddressRequest {
  address_id:    string;
  title:         string;
  address_line1: string;
  address_line2?: string;
  city:          string;
  state?:        string;
  postal_code?:  string;
  country:       string;
  map_urls?:     string[];
}

export function validateUpdateAddressRequest(r: UpdateAddressRequest): ValidationError[] { ... }

export interface DisableAddressRequest { address_id: string; }
export function validateDisableAddressRequest(r: DisableAddressRequest): ValidationError[] { ... }

export interface EnableAddressRequest  { address_id: string; }
export function validateEnableAddressRequest(r: EnableAddressRequest): ValidationError[] { ... }

export interface GetAddressRequest     { address_id: string; }
export function validateGetAddressRequest(r: GetAddressRequest): ValidationError[] { ... }

export interface ListAddressesRequest {
  filter_status?:   OrgAddressStatus;
  pagination_key?:  string;
  limit?:           number;
}

export function validateListAddressesRequest(r: ListAddressesRequest): ValidationError[] { ... }

export interface ListAddressesResponse {
  addresses:           OrgAddress[];
  next_pagination_key?: string;
}
```

Validation rules (apply identically in `.ts` and `.go`):

| Field         | Validations                                           |
| ------------- | ----------------------------------------------------- |
| title         | required; max 100 chars                               |
| address_line1 | required; max 200 chars                               |
| address_line2 | optional; max 200 chars when present                  |
| city          | required; max 100 chars                               |
| state         | optional; max 100 chars when present                  |
| postal_code   | optional; max 20 chars when present                   |
| country       | required; max 100 chars                               |
| map_urls      | optional; at most 5 entries; each entry max 500 chars |
| address_id    | required (in update/disable/enable/get); non-empty    |
| filter_status | optional; must be `"active"` or `"disabled"` if given |

**`specs/typespec/org/company-addresses.go`** — matching Go struct + `Validate()` methods using the same rules.

### Database Schema

Changes to `api-server/db/migrations/regional/00000000000001_initial_schema.sql`.

#### New ENUM type (add near other ENUM declarations at the top)

```sql
CREATE TYPE org_address_status AS ENUM ('active', 'disabled');
```

#### New table (add after the `suborgs` table)

```sql
CREATE TABLE org_addresses (
    address_id    UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID               NOT NULL,
    title         VARCHAR(100)       NOT NULL,
    address_line1 VARCHAR(200)       NOT NULL,
    address_line2 VARCHAR(200),
    city          VARCHAR(100)       NOT NULL,
    state         VARCHAR(100),
    postal_code   VARCHAR(20),
    country       VARCHAR(100)       NOT NULL,
    map_urls      TEXT[]             NOT NULL DEFAULT '{}',
    status        org_address_status NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_org_addresses_org_id_created_at ON org_addresses(org_id, created_at);
```

#### New roles (add to the INSERT INTO roles block)

```sql
('org:view_addresses',   'Can view company addresses (read-only)'),
('org:manage_addresses', 'Can create, update, enable and disable company addresses'),
```

#### DOWN section additions (add DROP statements in reverse creation order)

```sql
DROP INDEX IF EXISTS idx_org_addresses_org_id_created_at;
DROP TABLE IF EXISTS org_addresses;
DROP TYPE  IF EXISTS org_address_status;
```

#### SQL Queries

Add to `api-server/db/queries/regional.sql`:

```sql
-- ============================================
-- Company Address Queries (Regional)
-- ============================================

-- name: CreateOrgAddress :one
INSERT INTO org_addresses (org_id, title, address_line1, address_line2, city, state, postal_code, country, map_urls)
VALUES (@org_id, @title, @address_line1, @address_line2, @city, @state, @postal_code, @country, @map_urls)
RETURNING *;

-- name: GetOrgAddress :one
SELECT * FROM org_addresses
WHERE address_id = @address_id AND org_id = @org_id;

-- name: UpdateOrgAddress :one
UPDATE org_addresses
SET title         = @title,
    address_line1 = @address_line1,
    address_line2 = @address_line2,
    city          = @city,
    state         = @state,
    postal_code   = @postal_code,
    country       = @country,
    map_urls      = @map_urls,
    updated_at    = NOW()
WHERE address_id = @address_id AND org_id = @org_id
RETURNING *;

-- name: DisableOrgAddress :one
UPDATE org_addresses
SET status = 'disabled', updated_at = NOW()
WHERE address_id = @address_id AND org_id = @org_id AND status = 'active'
RETURNING *;

-- name: EnableOrgAddress :one
UPDATE org_addresses
SET status = 'active', updated_at = NOW()
WHERE address_id = @address_id AND org_id = @org_id AND status = 'disabled'
RETURNING *;

-- name: ListOrgAddresses :many
SELECT * FROM org_addresses
WHERE org_id = @org_id
  AND (sqlc.narg('filter_status')::org_address_status IS NULL
       OR status = sqlc.narg('filter_status')::org_address_status)
  AND (@cursor_created_at::timestamp IS NULL
       OR (created_at > @cursor_created_at)
       OR (created_at = @cursor_created_at AND address_id > @cursor_id))
ORDER BY created_at ASC, address_id ASC
LIMIT @limit_count;
```

`DisableOrgAddress` and `EnableOrgAddress` use a WHERE guard on the current status: if no rows are updated (pgx.ErrNoRows) the handler must first check if the address exists at all (separate `GetOrgAddress` within the tx) and return 404 vs 422 accordingly.

### Backend

#### Endpoints

| Method | Path                   | Handler file                        | Auth middleware | Role required          |
| ------ | ---------------------- | ----------------------------------- | --------------- | ---------------------- |
| POST   | `/org/create-address`  | `handlers/org/company-addresses.go` | `OrgAuth`       | `org:manage_addresses` |
| POST   | `/org/update-address`  | `handlers/org/company-addresses.go` | `OrgAuth`       | `org:manage_addresses` |
| POST   | `/org/disable-address` | `handlers/org/company-addresses.go` | `OrgAuth`       | `org:manage_addresses` |
| POST   | `/org/enable-address`  | `handlers/org/company-addresses.go` | `OrgAuth`       | `org:manage_addresses` |
| POST   | `/org/get-address`     | `handlers/org/company-addresses.go` | `OrgAuth`       | `org:view_addresses`   |
| POST   | `/org/list-addresses`  | `handlers/org/company-addresses.go` | `OrgAuth`       | `org:view_addresses`   |

#### Handler Notes

- All handlers: decode → validate → tx (for writes) / direct query (for reads) → respond.
- `create-address` returns **201** + OrgAddress JSON.
- `update-address` returns **200** + OrgAddress JSON; 404 if unknown address_id.
- `disable-address` returns **200** + OrgAddress JSON; 404 if not found; **422** if already `disabled`. Job-openings check (pending_review/published/paused → 422) is a TODO for when the openings feature is added.
- `enable-address` returns **200** + OrgAddress JSON; 404 if not found; **422** if already `active`.
- `get-address` returns **200** + OrgAddress JSON; 404 if not found.
- `list-addresses` returns **200** + ListAddressesResponse; keyset cursor encoded as `base64(created_at|address_id)`.
- `map_urls` stored as `TEXT[]`; when `nil` or absent in request, write `[]string{}` to DB.
- UUID parsing for address_id: use `pgtype.UUID.Scan(req.AddressID)`; return 400 if scan fails.

#### Audit Log Events

| event_type            | DB table                | actor_user_id | target_user_id | event_data keys       |
| --------------------- | ----------------------- | ------------- | -------------- | --------------------- |
| `org.create_address`  | `audit_logs` (regional) | org user      | —              | `address_id`, `title` |
| `org.update_address`  | `audit_logs` (regional) | org user      | —              | `address_id`, `title` |
| `org.disable_address` | `audit_logs` (regional) | org user      | —              | `address_id`          |
| `org.enable_address`  | `audit_logs` (regional) | org user      | —              | `address_id`          |

### Frontend

#### New Routes

| Portal | Route path            | Page component                          |
| ------ | --------------------- | --------------------------------------- |
| org-ui | `/settings/addresses` | `src/pages/Addresses/AddressesPage.tsx` |

#### AddressesPage layout

Standard feature page layout (maxWidth 1200, back button → Dashboard, Title level=2, no outer Card).

- **Header row**: `Title level={2}` "Company Addresses" (left) + "Add Address" primary button (right, hidden when no `manage_addresses` role)
- **Filter**: Ant Design `Segmented` or `Select` — All / Active / Disabled
- **Table** columns: Title | Address | City | Country | Status | Created At | Actions
  - "Address" column renders `address_line1` (and `address_line2` on next line if present)
  - Actions column: **Edit** (manage_addresses only) · **Disable** / **Re-enable** (manage_addresses only)
- **Add/Edit modal**: Ant Design `Modal` + `Form` with all fields; map_urls rendered as a dynamic list of text inputs (max 5, Add URL / Remove buttons)
- **Disable/Enable**: inline `Popconfirm` on the action link; no separate page
- **Load more** button at the bottom of the table for pagination (cursor-based, not page numbers)
- Wrap all network calls in `<Spin spinning={loading}>` to prevent double-submission
- Derive `canManage` from `myInfo.roles.includes("org:superadmin") || myInfo.roles.includes("org:manage_addresses")`

#### Route guard in `App.tsx`

Add `AddressesRoute` component (identical pattern to `CostCentersRoute`) checking for `org:view_addresses`, `org:manage_addresses`, or `org:superadmin`. Add `<Route path="/settings/addresses" element={<AddressesRoute><AddressesPage /></AddressesRoute>} />`.

### RBAC

#### New roles

All four locations must be kept in sync:

- `specs/typespec/common/roles.ts` — add to `VALID_ROLE_NAMES` array
- `specs/typespec/common/roles.go` — add to `ValidRoleNames` slice
- `specs/typespec/org/org-users.ts` — add `OrgRoleViewAddresses` and `OrgRoleManageAddresses` constants
- `specs/typespec/org/org-users.go` — add matching Go constants in the `const` block

| Role name              | Portal | Description                                              |
| ---------------------- | ------ | -------------------------------------------------------- |
| `org:view_addresses`   | org    | Can view company addresses (read-only)                   |
| `org:manage_addresses` | org    | Can create, update, enable and disable company addresses |

Also register the two middleware instances in `api-server/internal/routes/org-routes.go`:

```go
orgRoleViewAddresses   := middleware.OrgRole(s.Regional, orgspec.OrgRoleViewAddresses, orgspec.OrgRoleManageAddresses)
orgRoleManageAddresses := middleware.OrgRole(s.Regional, orgspec.OrgRoleManageAddresses)
```

### i18n

Files: `org-ui/src/locales/en-US/addresses.json`, `de-DE/addresses.json`, `ta-IN/addresses.json`.

Minimum `en-US` keys:

```json
{
	"title": "Company Addresses",
	"addAddress": "Add Address",
	"backToDashboard": "Back to Dashboard",
	"filterAll": "All",
	"filterActive": "Active",
	"filterDisabled": "Disabled",
	"table": {
		"title": "Title",
		"address": "Address",
		"city": "City",
		"country": "Country",
		"status": "Status",
		"createdAt": "Created At",
		"actions": "Actions",
		"edit": "Edit",
		"disable": "Disable",
		"reenable": "Re-enable"
	},
	"form": {
		"title": "Title",
		"addressLine1": "Address Line 1",
		"addressLine2": "Address Line 2",
		"city": "City",
		"state": "State / Province",
		"postalCode": "Postal Code",
		"country": "Country",
		"mapUrls": "Map URLs",
		"addMapUrl": "Add URL",
		"saveAddress": "Save Address"
	},
	"addModal": { "title": "Add Address" },
	"editModal": { "title": "Edit Address" },
	"disableConfirm": "Disable this address?",
	"enableConfirm": "Re-enable this address?",
	"success": {
		"created": "Address created successfully",
		"updated": "Address updated successfully",
		"disabled": "Address disabled",
		"enabled": "Address re-enabled"
	},
	"errors": {
		"loadFailed": "Failed to load addresses",
		"saveFailed": "Failed to save address",
		"disableFailed": "Failed to disable address",
		"enableFailed": "Failed to re-enable address",
		"inUse": "Cannot disable: address is used by one or more active job openings"
	}
}
```

Provide placeholder translations (same English text) in `de-DE/addresses.json` and `ta-IN/addresses.json`.

### Test Matrix

Tests in `playwright/tests/api/org/company-addresses.spec.ts`. Types imported from `vetchium-specs/org/company-addresses`.

Also add methods to `playwright/lib/org-api-client.ts`:

- `createAddress`, `createAddressRaw`
- `updateAddress`, `updateAddressRaw`
- `disableAddress`, `disableAddressRaw`
- `enableAddress`, `enableAddressRaw`
- `getAddress`, `getAddressRaw`
- `listAddresses`, `listAddressesRaw`

| Scenario                                | Endpoint        | Expected status                         |
| --------------------------------------- | --------------- | --------------------------------------- |
| Success — all required fields only      | create-address  | 201 + OrgAddress in response            |
| Success — all fields including optional | create-address  | 201 + OrgAddress in response            |
| Missing required field (title)          | create-address  | 400                                     |
| Missing required field (address_line1)  | create-address  | 400                                     |
| Missing required field (city)           | create-address  | 400                                     |
| Missing required field (country)        | create-address  | 400                                     |
| Field too long (title > 100)            | create-address  | 400                                     |
| map_urls > 5 entries                    | create-address  | 400                                     |
| map_url entry > 500 chars               | create-address  | 400                                     |
| Unauthenticated                         | create-address  | 401                                     |
| RBAC negative (no roles)                | create-address  | 403                                     |
| RBAC positive (manage_addresses role)   | create-address  | 201                                     |
| Audit log written on success            | create-address  | `org.create_address` entry present      |
| No audit log on failure                 | create-address  | count unchanged                         |
| Success                                 | get-address     | 200 + OrgAddress                        |
| Missing address_id                      | get-address     | 400                                     |
| Unauthenticated                         | get-address     | 401                                     |
| RBAC negative (no roles)                | get-address     | 403                                     |
| RBAC positive (view_addresses role)     | get-address     | 200                                     |
| Not found                               | get-address     | 404                                     |
| Success                                 | update-address  | 200 + updated OrgAddress                |
| Missing required field                  | update-address  | 400                                     |
| Unauthenticated                         | update-address  | 401                                     |
| RBAC negative (no roles)                | update-address  | 403                                     |
| Not found                               | update-address  | 404                                     |
| Audit log written on success            | update-address  | `org.update_address` entry present      |
| Success (active → disabled)             | disable-address | 200 + OrgAddress with status=disabled   |
| Missing address_id                      | disable-address | 400                                     |
| Unauthenticated                         | disable-address | 401                                     |
| RBAC negative (no roles)                | disable-address | 403                                     |
| Not found                               | disable-address | 404                                     |
| Already disabled (invalid state)        | disable-address | 422                                     |
| Audit log written on success            | disable-address | `org.disable_address` entry present     |
| Success (disabled → active)             | enable-address  | 200 + OrgAddress with status=active     |
| Missing address_id                      | enable-address  | 400                                     |
| Unauthenticated                         | enable-address  | 401                                     |
| RBAC negative (no roles)                | enable-address  | 403                                     |
| Not found                               | enable-address  | 404                                     |
| Already active (invalid state)          | enable-address  | 422                                     |
| Audit log written on success            | enable-address  | `org.enable_address` entry present      |
| Success — all addresses                 | list-addresses  | 200 + addresses array                   |
| Success — filter active                 | list-addresses  | 200 + only active addresses             |
| Success — filter disabled               | list-addresses  | 200 + only disabled addresses           |
| Pagination (cursor)                     | list-addresses  | 200 + next_pagination_key when has more |
| Unauthenticated                         | list-addresses  | 401                                     |
| RBAC negative (no roles)                | list-addresses  | 403                                     |
| RBAC positive (view_addresses role)     | list-addresses  | 200                                     |
