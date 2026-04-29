## Stage 1: Requirements

Status: DRAFT
Authors: @psankar
Dependencies: marketplace-v2 (staffing provider notification relies on marketplace capabilities)

### Overview

Job Openings let OrgUsers create and publish job postings on the Vetchium platform. Each opening goes through an intra-org approval flow (Draft → Pending Review → Published) before becoming visible to HubUsers. A hiring manager — always an active OrgUser in the same org — must be assigned at creation time. When published, an opening can optionally notify marketplace providers that have the Staffing capability. This spec covers only opening creation and lifecycle management; the HubUser application process is a separate spec.

Portals affected: Org portal (full lifecycle), Hub portal (discovery and read-only view). All write operations are initiated by OrgUsers.

### Acceptance Criteria

- [ ] OrgUser with `org:manage_openings` can create a new opening; it starts in `draft` state
- [ ] Required fields: title, description, employment type, work location type, number of positions, hiring manager
- [ ] Optional fields: location (city + country — required when work_location_type is `on_site` or `hybrid`), experience range (min/max years), salary range (min, max, currency), cost center, tags, expiry date, internal notes, notify staffing providers flag
- [ ] Hiring manager must be an active OrgUser belonging to the same org
- [ ] A `draft` opening can be edited; editing is blocked once it leaves `draft`
- [ ] OrgUser with `org:manage_openings` can submit a `draft` opening for review → `pending_review`
- [ ] OrgUser with `org:manage_openings` can approve a `pending_review` opening → `published`
- [ ] OrgUser with `org:manage_openings` can reject a `pending_review` opening → back to `draft` with a rejection note stored on the opening
- [ ] On approval, if `notify_staffing_providers` is true, all orgs with an active marketplace listing containing the Staffing capability receive a notification (mechanism defined in Stage 2)
- [ ] OrgUser with `org:manage_openings` can pause a `published` opening → `paused` (hidden from Hub)
- [ ] OrgUser with `org:manage_openings` can reopen a `paused` opening → `published`
- [ ] OrgUser with `org:manage_openings` can close a `published` or `paused` opening → `closed`
- [ ] OrgUser with `org:manage_openings` can archive a `closed` opening → `archived`
- [ ] OrgUser with `org:manage_openings` can duplicate any opening → creates a new `draft` copy with the same fields
- [ ] OrgUser with `org:view_openings` can list and view openings (read-only); write operations require `org:manage_openings`
- [ ] Opening list supports filtering by status and keyset pagination
- [ ] HubUser with `hub:read_posts` can browse `published` openings and view individual opening details
- [ ] Hub opening list supports filtering by employment type and work location type, with keyset pagination
- [ ] Audit log written inside the same transaction for every state-changing operation
- [ ] New roles `org:view_openings` and `org:manage_openings` defined in roles.ts, roles.go, and initial_schema.sql

### User-Facing Screens

**Screen: Opening List (Org)**

Portal: org-ui | Route: `/openings`

Header: Back to Dashboard button | "Job Openings" title (h2) | "Create Opening" button (right)

Filter: Status dropdown — All / Draft / Pending Review / Published / Paused / Closed / Archived

| Title | Hiring Manager | Employment Type | Location | Positions | Status | Created At | Actions                                                                                                                      |
| ----- | -------------- | --------------- | -------- | --------- | ------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| …     | …              | …               | …        | …         | …      | …          | View · Edit · Submit · Approve/Reject · Pause · Reopen · Close · Archive · Duplicate (shown contextually by status and role) |

**Screen: Create Opening**

Triggered by: "Create Opening" button on list page | Portal: org-ui | Route: `/openings/new`

| Field                     | Type         | Constraints                                                       |
| ------------------------- | ------------ | ----------------------------------------------------------------- |
| Title                     | text         | required, max 200 chars                                           |
| Description               | textarea     | required, max 10 000 chars                                        |
| Employment Type           | select       | required — `full_time` / `part_time` / `contract` / `internship`  |
| Work Location Type        | select       | required — `remote` / `on_site` / `hybrid`                        |
| City                      | text         | required when work_location_type is `on_site` or `hybrid`         |
| Country                   | text         | required when work_location_type is `on_site` or `hybrid`         |
| Min Experience (years)    | number       | optional, 0–50                                                    |
| Max Experience (years)    | number       | optional, 0–50, ≥ min                                             |
| Min Salary                | number       | optional, ≥ 0                                                     |
| Max Salary                | number       | optional, ≥ min salary                                            |
| Salary Currency           | text         | optional, ISO 4217, max 3 chars (e.g. USD)                        |
| Number of Positions       | number       | required, min 1                                                   |
| Hiring Manager            | select       | required — populated from active OrgUsers in the same org         |
| Cost Center               | select       | optional — populated from org cost centers                        |
| Tags / Skills             | multi-select | optional, max 20 tags                                             |
| Expiry Date               | date         | optional — opening auto-closes on this date                       |
| Internal Notes            | textarea     | optional, max 2 000 chars — not visible to HubUsers               |
| Notify Staffing Providers | checkbox     | optional — notifies providers with Staffing capability on publish |

Submit button: "Save as Draft"

**Screen: Opening Detail (Org)**

Portal: org-ui | Route: `/openings/:opening_id`

Displays all opening fields in read mode. Action buttons rendered based on status and user role:

- DRAFT: Edit, Submit for Review, Duplicate
- PENDING_REVIEW: Approve, Reject (with rejection note input), Duplicate; rejection note from prior rejection shown if present
- PUBLISHED: Pause, Close, Duplicate
- PAUSED: Reopen, Close, Duplicate
- CLOSED: Archive, Duplicate
- ARCHIVED: Duplicate only

**Screen: Edit Opening**

Portal: org-ui | Route: `/openings/:opening_id/edit`

Same form as Create Opening, pre-populated. Available only when status is `draft`. Saving replaces all editable fields.

**Screen: Opening Browse (Hub)**

Portal: hub-ui | Route: `/openings`

Header: Back to Dashboard button | "Job Openings" title (h2)

Filters: Employment Type dropdown (All / Full-time / Part-time / Contract / Internship) · Work Location dropdown (All / Remote / On-site / Hybrid)

| Title | Organization | Location | Employment Type | Posted At | Actions |
| ----- | ------------ | -------- | --------------- | --------- | ------- |
| …     | …            | …        | …               | …         | View    |

**Screen: Opening Detail (Hub)**

Portal: hub-ui | Route: `/openings/:opening_id`

Displays: title, org name, description, employment type, work location type, location, experience range, salary range (if provided), tags, number of positions, published date. Internal notes and hiring manager details are NOT shown. Apply button is rendered but labelled "Applications opening soon" and is disabled (application spec is separate).

### API Surface

| Endpoint                       | Portal | Who calls it              | What it does                                                                     |
| ------------------------------ | ------ | ------------------------- | -------------------------------------------------------------------------------- |
| `POST /org/openings/create`    | org    | OrgUser (manage_openings) | Creates a new opening in `draft` state                                           |
| `POST /org/openings/list`      | org    | OrgUser (view_openings)   | Paginates openings for the org; optional status filter                           |
| `POST /org/openings/get`       | org    | OrgUser (view_openings)   | Gets a single opening by ID including internal notes                             |
| `POST /org/openings/update`    | org    | OrgUser (manage_openings) | Replaces all editable fields on a `draft` opening                                |
| `POST /org/openings/duplicate` | org    | OrgUser (manage_openings) | Creates a new `draft` copy of any existing opening                               |
| `POST /org/openings/submit`    | org    | OrgUser (manage_openings) | Moves a `draft` opening to `pending_review`                                      |
| `POST /org/openings/approve`   | org    | OrgUser (manage_openings) | Moves `pending_review` → `published`; triggers provider notifications if flagged |
| `POST /org/openings/reject`    | org    | OrgUser (manage_openings) | Moves `pending_review` → `draft` with a required rejection note                  |
| `POST /org/openings/pause`     | org    | OrgUser (manage_openings) | Moves `published` → `paused`                                                     |
| `POST /org/openings/reopen`    | org    | OrgUser (manage_openings) | Moves `paused` → `published`                                                     |
| `POST /org/openings/close`     | org    | OrgUser (manage_openings) | Moves `published` or `paused` → `closed`                                         |
| `POST /org/openings/archive`   | org    | OrgUser (manage_openings) | Moves `closed` → `archived`                                                      |
| `POST /hub/openings/list`      | hub    | HubUser (read_posts)      | Paginates `published` openings; filters by employment type / location type       |
| `POST /hub/openings/get`       | hub    | HubUser (read_posts)      | Gets a single `published` opening by ID (no internal notes)                      |

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

@route("/org/foo/create")
op createFoo(...CreateFooRequest): CreatedResponse<FooResponse> | BadRequestResponse;

@route("/org/foo/list")
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
| POST   | `/org/foo/create` | `handlers/org/foo.go` | `OrgAuth`       | `org:manage_foo` |
| POST   | `/org/foo/list`   | `handlers/org/foo.go` | `OrgAuth`       | `org:view_foo`   |

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
