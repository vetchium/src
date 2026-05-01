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

> **Do not fill this section until Stage 1 status is APPROVED.**

Status: DRAFT
Authors: @

### API Contract

TypeSpec definitions in `specs/typespec/{portal}/{feature}.tsp` with matching `.ts` and `.go` files. These are the source of truth — all request/response types must be defined here and imported everywhere else.

```typespec
// specs/typespec/org/feature.tsp

model CreateFooRequest {
  name: string;
  description?: string;
}

model FooResponse {
  id: string;
  name: string;
  created_at: utcDateTime;
}

@route("/org/create-foo")
op createFoo(...CreateFooRequest): CreatedResponse<FooResponse> | BadRequestResponse;

@route("/org/list-foos")
op listFoo(...ListFooRequest): OkResponse<FooListResponse> | BadRequestResponse;
```

### Database Schema

Changes to `api-server/db/migrations/{global,regional}/00000000000001_initial_schema.sql`. No new migration files — edit the initial schema directly.

#### Tables / Columns

```sql
-- Regional DB
CREATE TABLE foos (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id     UUID NOT NULL,
    name       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### SQL Queries

New query files in `api-server/db/{global,regional}/queries/`. Annotate with sqlc directives.

```sql
-- name: CreateFoo :one
INSERT INTO foos (org_id, name) VALUES ($1, $2) RETURNING *;

-- name: ListFoos :many
SELECT * FROM foos
WHERE org_id = $1
  AND ($2::uuid IS NULL OR id < $2)
ORDER BY id DESC
LIMIT $3;
```

### Backend

#### Endpoints

| Method | Path              | Handler file          | Auth middleware | Role required    |
| ------ | ----------------- | --------------------- | --------------- | ---------------- |
| POST   | `/org/create-foo` | `handlers/org/foo.go` | `OrgAuth`       | `org:manage_foo` |
| POST   | `/org/list-foos`  | `handlers/org/foo.go` | `OrgAuth`       | `org:view_foo`   |

#### Handler Notes

- Decode → validate → tx → respond
- All writes use `s.WithRegionalTx` / `s.WithGlobalTx`
- Audit log write MUST be inside the same transaction as the primary write

#### Audit Log Events

| event_type       | DB table                | actor_user_id | target_user_id | event_data keys  |
| ---------------- | ----------------------- | ------------- | -------------- | ---------------- |
| `org.create_foo` | `audit_logs` (regional) | org user      | —              | `foo_id`, `name` |

### Frontend

#### New Routes

| Portal | Route path | Page component              |
| ------ | ---------- | --------------------------- |
| org-ui | `/foo`     | `src/pages/FooListPage.tsx` |

#### Implementation Notes

- Standard page layout: maxWidth 1200, back button first, Title level=2, no outer Card
- Wrap network calls with `<Spin spinning={loading}>` to prevent double-submission
- Disable submit while form has validation errors

### RBAC

#### New roles (if any)

All three locations must be kept in sync:

- `specs/typespec/common/roles.ts`
- `specs/typespec/common/roles.go`
- `api-server/db/migrations/.../00000000000001_initial_schema.sql` (INSERT into `roles`)

| Role name        | Portal | Description               |
| ---------------- | ------ | ------------------------- |
| `org:view_foo`   | org    | Read-only access to foos  |
| `org:manage_foo` | org    | Create, edit, delete foos |

#### Existing roles reused

List any existing roles this feature checks against.

### i18n

Minimum: provide `en-US` values. Add matching keys to `de-DE` and `ta-IN`.

```json
{
	"fooList": {
		"title": "Foos",
		"addFoo": "Add Foo",
		"backToDashboard": "Back to Dashboard",
		"name": "Name",
		"status": "Status",
		"createdAt": "Created At",
		"createSuccess": "Foo created successfully",
		"deleteSuccess": "Foo deleted successfully"
	}
}
```

### Test Matrix

Tests in `playwright/tests/api/{portal}/foo.spec.ts`. All types imported from `specs/typespec/`.

| Scenario                     | Request                              | Expected status                 |
| ---------------------------- | ------------------------------------ | ------------------------------- |
| Success — create             | valid body                           | 201 + resource in response      |
| Success — list               | valid pagination                     | 200 + items array               |
| Missing required field       | `name` omitted                       | 400                             |
| Invalid field value          | `name: ""`                           | 400                             |
| Unauthenticated              | no / invalid token                   | 401                             |
| Wrong role (RBAC negative)   | authenticated, no roles              | 403                             |
| Correct role (RBAC positive) | non-superadmin with `org:manage_foo` | 201                             |
| Not found                    | unknown ID                           | 404                             |
| Invalid state                | e.g. already deleted                 | 422                             |
| Audit log written            | after success case                   | entry with correct `event_type` |
| No audit log on failure      | after 4xx                            | count unchanged                 |
