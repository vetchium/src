## Stage 1: Requirements

Status: DRAFT | REVIEW | APPROVED
Authors: @
Dependencies:

### Overview

One paragraph: what problem this solves, which portal(s) are affected (Admin / Org / Hub), and which user types are involved.

### Acceptance Criteria

- [ ] Bullet points from both the user and developer perspectives

### User-Facing Screens

Describe each screen in terms of what the user sees and does. Use HTML to sketch inputs and table columns — no implementation details yet.

**Screen: Foo List**

Portal: org-ui | Route: `/foo`

```html
<table>
	<Column title="Name" />
	<Column title="Status" />
	<Column title="Created At" />
	<Column title="Actions">Edit | Delete</Column>
</table>
```

**Screen: Create Foo**

Triggered by: "Add Foo" button on the list page

```html
<form>
	<label>Name (required, max 100 chars)</label>
	<input type="text" id="name" required maxlength="100" />

	<label>Description (optional, max 500 chars)</label>
	<textarea id="description" maxlength="500"></textarea>

	<button type="submit">Create</button>
</form>
```

### API Surface

List the endpoints by name and intent only — no TypeSpec yet. Confirm these with the team before proceeding to Stage 2.

| Endpoint               | Portal | Who calls it | What it does               |
| ---------------------- | ------ | ------------ | -------------------------- |
| `POST /org/foo/create` | org    | Org user     | Creates a new Foo          |
| `POST /org/foo/list`   | org    | Org user     | Paginates Foos for the org |
| `POST /org/foo/delete` | org    | Org user     | Deletes a Foo by ID        |

---

## Stage 2: Implementation Plan

> **Do not fill this section until Stage 1 status is APPROVED.**

Status: DRAFT | REVIEW | READY
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
