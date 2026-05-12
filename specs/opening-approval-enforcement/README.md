## Stage 1: Requirements

Status: APPROVED
Authors: @psankar
Dependencies: job-openings

### Overview

The Opening approval flow (Draft → Pending Review → Published) has a self-approval gap: any org user with `org:manage_openings` can both submit their own opening and immediately approve it, rendering the two-step review meaningless for non-superadmin users. This spec fixes that by tracking who submitted each opening, enforcing a different-user constraint on approval, surfacing the submitter in the opening detail UI, and adding tests for the new constraint. Affected portal: Org. User types: org users with `org:manage_openings` role.

### Acceptance Criteria

- [ ] When a non-superadmin org user submits an opening (Draft → Pending Review), `submitted_by_org_user_id` is recorded in the DB.
- [ ] Any org user who submitted an opening **cannot** approve it themselves — `POST /org/approve-opening` returns 422 when the actor is the submitter.
- [ ] A **different** org user with `org:manage_openings` (or `org:superadmin`) can still approve the opening → 200.
- [ ] On rejection (Pending Review → Draft), `submitted_by_org_user_id` is cleared so the opening can be resubmitted by anyone.
- [ ] On approval (Pending Review → Published), `submitted_by_org_user_id` is retained for audit purposes.
- [ ] `GET /org/get-opening` (and list response where applicable) includes `submitted_by` (name + email) when the opening is in Pending Review.
- [ ] `GET /org/myinfo` includes `email_address` so the frontend can compare it against `submitted_by`.
- [ ] The Opening detail page hides the **Approve** button when the logged-in user is the submitter; the **Reject** (withdraw) button remains visible.
- [ ] The Opening detail page shows a "Submitted by" row in the team section when status is `pending_review`.
- [ ] The superadmin shortcut (Draft → Published on submit) is unaffected — superadmins never go through Pending Review.
- [ ] Existing state-transition tests continue to pass without modification.
- [ ] A positive RBAC test for `approve-opening` exists: non-superadmin WITH `org:manage_openings` role approves a pending_review opening submitted by a different user → 200.
- [ ] A self-approval test exists: the submitter attempts to approve their own pending_review opening → 422.
- [ ] Audit log entries for `org.submit_opening`, `org.publish_opening` (approve path), and `org.reject_opening` continue to be written correctly.

### User-Facing Screens

**Screen: Opening Detail — Pending Review state**

Portal: org-ui | Route: `/openings/:openingNumber`

Changes to the existing detail page only — no new routes.

```html
<!-- Team section — new row when status is pending_review -->
<table>
	<tr>
		<td>Hiring Manager</td>
		<td>Alice Example (alice@example.com)</td>
	</tr>
	<tr>
		<td>Recruiter</td>
		<td>Bob Example (bob@example.com)</td>
	</tr>
	<tr>
		<td>Submitted By</td>
		<td>Carol Example (carol@example.com)</td>
	</tr>
	<!-- shown only when status === "pending_review" and submitted_by is present -->
</table>

<!-- Action buttons when status is pending_review -->

<!-- Case A: current user is NOT the submitter -->
<button>Approve</button>
<button>Reject</button>
<button>Duplicate</button>

<!-- Case B: current user IS the submitter (same email_address) -->
<!-- Approve button is hidden; Reject (withdraw) remains -->
<button>Reject</button>
<button>Duplicate</button>
```

No new pages, modals, or routes are required.

### API Surface

No new endpoints. The following existing endpoints change behaviour or response shape:

| Endpoint                    | Portal | Change                                                                                     |
| --------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `POST /org/submit-opening`  | org    | Now records `submitted_by_org_user_id`; response `Opening` gains `submitted_by` field      |
| `POST /org/approve-opening` | org    | Returns 422 when actor == submitter; `submitted_by` retained in response                   |
| `POST /org/reject-opening`  | org    | Clears `submitted_by_org_user_id` in DB; `submitted_by` absent in response (back to draft) |
| `POST /org/get-opening`     | org    | Response `Opening` gains `submitted_by?: OrgUserShort` field                               |
| `POST /org/list-openings`   | org    | No shape change (summary type only; `submitted_by` not needed in list view)                |
| `GET /org/myinfo`           | org    | Response gains `email_address` field so frontend can detect self-approval                  |

---

## Stage 2: Implementation Plan

> **Do not fill this section until Stage 1 status is APPROVED.**

Status: DRAFT
Authors: @psankar

### API Contract

No new TypeSpec files. The changes are additive modifications to two existing files.

#### `specs/typespec/org/openings.tsp` — add `submitted_by` to `Opening`

```typespec
model Opening {
  // ... existing fields unchanged ...
  submitted_by?:              OrgUserShort;   // present when status = pending_review
  // ... rest unchanged ...
}
```

Place `submitted_by?` after `recruiter` in field order to keep team-related fields together.

#### `specs/typespec/org/org-users.tsp` — add `email_address` to `OrgMyInfoResponse`

```typespec
model OrgMyInfoResponse {
  full_name:          string;
  preferred_language: LanguageCode;
  org_name:           string;
  org_domain:         DomainName;
  roles:              string[];
  email_address:      EmailAddress;   // NEW — needed for self-approval detection on the frontend
}
```

Note: `has_failing_domains` already exists in the `.ts` and `.go` files but is missing from the `.tsp`. That pre-existing drift is out of scope for this spec.

#### Manual sync: `specs/typespec/org/openings.ts`

Add to the `Opening` interface:

```typescript
submitted_by?: OrgUserShort;   // present when status === "pending_review"
```

#### Manual sync: `specs/typespec/org/openings.go`

Add to the `Opening` struct:

```go
SubmittedBy map[string]string `json:"submitted_by,omitempty"`
```

Uses `map[string]string` for consistency with `HiringManager` and `Recruiter` (the handler populates all three the same way via `usersByID`).

#### Manual sync: `specs/typespec/org/org-users.ts`

Add to `OrgMyInfoResponse`:

```typescript
email_address: string;
```

#### Manual sync: `specs/typespec/org/org-users.go`

Add to `OrgMyInfoResponse`:

```go
EmailAddress common.EmailAddress `json:"email_address"`
```

---

### Database Schema

Edit `api-server/db/migrations/regional/00000000000001_initial_schema.sql` — no new migration files.

Add one nullable column to the `openings` CREATE TABLE statement, after `recruiter_org_user_id`:

```sql
CREATE TABLE openings (
  ...
  hiring_manager_org_user_id UUID             NOT NULL,
  recruiter_org_user_id      UUID             NOT NULL,
  submitted_by_org_user_id   UUID,            -- NULL until submitted; cleared on rejection
  ...
);
```

No index required. The column is only ever filtered on in the UPDATE WHERE clause of `TransitionOpeningApprove`, where it is ANDed with the PK-equivalent `(org_id, opening_number)` pair.

---

### SQL Queries

All changes are in `api-server/db/queries/regional.sql`. Run `sqlc generate` after editing.

#### `TransitionOpeningSubmit` — record submitter

```sql
-- name: TransitionOpeningSubmit :one
UPDATE openings
SET status                    = @target_status,
    submitted_by_org_user_id  = @submitted_by_org_user_id,
    first_published_at        = CASE WHEN @target_status = 'published'::opening_status
                                     THEN NOW() ELSE first_published_at END,
    rejection_note            = NULL,
    updated_at                = NOW()
WHERE org_id = @org_id AND opening_number = @opening_number AND status = 'draft'
RETURNING *;
```

When `target_status` is `published` (superadmin shortcut), `submitted_by_org_user_id` is still set — this is harmless and provides a complete audit trail.

#### `TransitionOpeningApprove` — enforce different-user constraint

```sql
-- name: TransitionOpeningApprove :one
UPDATE openings
SET status              = 'published',
    first_published_at  = NOW(),
    updated_at          = NOW()
WHERE org_id = @org_id
  AND opening_number    = @opening_number
  AND status            = 'pending_review'
  AND submitted_by_org_user_id != @actor_user_id
RETURNING *;
```

The added `AND submitted_by_org_user_id != @actor_user_id` causes the UPDATE to match zero rows when the approver is the submitter. The existing handler error path already disambiguates zero-rows-because-not-found (404) vs zero-rows-because-wrong-state (422) by re-fetching the opening, so self-approval returns 422 with no handler changes.

#### `TransitionOpeningReject` — clear submitter on return to draft

```sql
-- name: TransitionOpeningReject :one
UPDATE openings
SET status                    = 'draft',
    submitted_by_org_user_id  = NULL,
    rejection_note            = @rejection_note,
    updated_at                = NOW()
WHERE org_id = @org_id AND opening_number = @opening_number AND status = 'pending_review'
RETURNING *;
```

Clearing on rejection allows the opening to be resubmitted by any authorized user; the next submit will record the new submitter.

---

### Backend

#### Endpoints

No new routes. Modified handlers only.

| Method | Path                   | Handler file                                   | Auth      | Role                  | Change                                        |
| ------ | ---------------------- | ---------------------------------------------- | --------- | --------------------- | --------------------------------------------- |
| POST   | `/org/submit-opening`  | `handlers/org/openings.go:SubmitOpening`       | `OrgAuth` | `org:manage_openings` | Pass submitter UUID in SQL params             |
| POST   | `/org/approve-opening` | `handlers/org/openings.go:ApproveOpening`      | `OrgAuth` | `org:manage_openings` | Pass actor UUID in SQL params                 |
| POST   | `/org/reject-opening`  | `handlers/org/openings.go:RejectOpening`       | `OrgAuth` | `org:manage_openings` | No params change; SQL now clears submitted_by |
| POST   | `/org/get-opening`     | `handlers/org/openings.go:dbOpeningToResponse` | `OrgAuth` | `org:view_openings`   | Populate submitted_by in response             |
| GET    | `/org/myinfo`          | `handlers/org/myinfo.go:MyInfo`                | `OrgAuth` | —                     | Add email_address to response                 |

#### Handler Notes

**`SubmitOpening`** (`handlers/org/openings.go`):

```go
updated, err := qtx.TransitionOpeningSubmit(ctx, regionaldb.TransitionOpeningSubmitParams{
    TargetStatus:            targetStatus,
    SubmittedByOrgUserID:    orgUser.OrgUserID,   // NEW
    OrgID:                   orgUser.OrgID,
    OpeningNumber:           req.OpeningNumber,
})
```

**`ApproveOpening`** (`handlers/org/openings.go`):

```go
updated, err := qtx.TransitionOpeningApprove(ctx, regionaldb.TransitionOpeningApproveParams{
    ActorUserID:   orgUser.OrgUserID,   // NEW — compared against submitted_by_org_user_id
    OrgID:         orgUser.OrgID,
    OpeningNumber: req.OpeningNumber,
})
```

The existing error handler after this call already returns 422 when the opening exists but the UPDATE affected zero rows, so self-approval correctly returns 422 with no further changes.

**`dbOpeningToResponse`** (`handlers/org/openings.go`):

Add `opening.SubmittedByOrgUserID` to the bulk `userIDs` map that feeds `GetOrgUsersByIDs`. After the bulk fetch, populate:

```go
if opening.SubmittedByOrgUserID.Valid {
    if user, ok := usersByID[opening.SubmittedByOrgUserID]; ok {
        resp.SubmittedBy = user
    }
}
```

This keeps the round-trip count unchanged (one bulk user fetch per call).

**`MyInfo`** (`handlers/org/myinfo.go`):

```go
response := orgtypes.OrgMyInfoResponse{
    // ... existing fields ...
    EmailAddress: common.EmailAddress(orgUser.EmailAddress),   // NEW
}
```

`orgUser.EmailAddress` is already loaded by the auth middleware — no additional DB query.

#### Audit Log Events

No changes to event types or event data. The three affected transitions continue writing the same events:

| event_type            | DB table              | actor_user_id | Notes                                                   |
| --------------------- | --------------------- | ------------- | ------------------------------------------------------- |
| `org.submit_opening`  | `audit_logs` regional | org user      | Unchanged                                               |
| `org.publish_opening` | `audit_logs` regional | org user      | Unchanged (both submit-as-superadmin and approve paths) |
| `org.reject_opening`  | `audit_logs` regional | org user      | Unchanged                                               |

---

### Frontend

#### Modified files (no new routes)

| Portal | File                                       | Change                                                    |
| ------ | ------------------------------------------ | --------------------------------------------------------- |
| org-ui | `src/pages/Openings/OpeningDetailPage.tsx` | Hide Approve button for submitter; add "Submitted By" row |

#### Implementation Notes

**Detect self-approval** using already-loaded `myInfo`:

```tsx
const isSubmitter =
	opening.status === "pending_review" &&
	!!opening.submitted_by &&
	opening.submitted_by.email_address === myInfo?.email_address;
```

**`renderActions()` for `pending_review`** — filter out Approve when `isSubmitter`:

```tsx
pending_review: [
    ...(!isSubmitter ? [
        <Button key="approve" onClick={...}>{t("table.approve")}</Button>,
    ] : []),
    <Button key="reject" onClick={handleRejectModal}>{t("table.reject")}</Button>,
    <Button key="duplicate" onClick={handleDuplicate}>{t("table.duplicate")}</Button>,
],
```

**`teamItems` in the detail Descriptions** — add the submitted_by row after recruiter:

```tsx
...(opening.status === "pending_review" && opening.submitted_by
    ? [{
          key: "submitted_by",
          label: t("detail.submittedBy"),
          children: userLabel(opening.submitted_by),
      }]
    : []),
```

No layout changes — this slots into the existing `<Descriptions>` component in the Hiring Team card.

---

### RBAC

No new roles. Existing roles reused without change:

| Role                  | Used by                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `org:manage_openings` | `submit-opening`, `approve-opening`, `reject-opening`                   |
| `org:view_openings`   | `get-opening` (reads submitted_by)                                      |
| `org:superadmin`      | Bypasses role checks; superadmin shortcut skips pending_review entirely |

---

### i18n

Add one key to the `detail` section in all three locale files.

**`org-ui/src/locales/en-US/openings.json`**:

```json
"detail": {
    ...
    "submittedBy": "Submitted By"
}
```

**`org-ui/src/locales/de-DE/openings.json`**:

```json
"detail": {
    ...
    "submittedBy": "Eingereicht von"
}
```

**`org-ui/src/locales/ta-IN/openings.json`**:

```json
"detail": {
    ...
    "submittedBy": "சமர்ப்பித்தவர்"
}
```

---

### Test Matrix

Add tests to `playwright/tests/api/org/openings-state-transitions.spec.ts` for the state-transition cases, and to `playwright/tests/api/org/openings-rbac-transitions.spec.ts` for the RBAC positive case.

#### New tests in `openings-state-transitions.spec.ts`

| Scenario                               | Setup                                                                                                          | Expected                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Self-approval → 422                    | Non-superadmin user A (with `manage_openings`) creates + submits opening → same user A calls `approve-opening` | 422                                                                |
| Submitter can reject own opening       | Non-superadmin user A submits → user A calls `reject-opening`                                                  | 200; opening back to draft; `submitted_by` absent in `get-opening` |
| `submitted_by` populated after submit  | Non-superadmin user A submits → `get-opening` response                                                         | `submitted_by.email_address === userA.email`; absent after reject  |
| `submitted_by` cleared after rejection | User A submits → user B rejects → `get-opening` response                                                       | `submitted_by` field absent (null/omitted)                         |

#### New test in `openings-rbac-transitions.spec.ts`

| Scenario                                                                                            | Setup                                                                                           | Expected                        |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------- |
| `approve-opening`: non-superadmin with `manage_openings` approves different user's submission → 200 | User A (manage_openings) submits opening → user B (manage_openings, different account) approves | 200; opening status `published` |

**Note**: This is the currently missing positive RBAC test for `approve-opening`. It requires two distinct users with `manage_openings` in the same org — use `createTestOrgUserDirect` with `{ orgId, domain }` for user B, matching the pattern in existing RBAC tests.

#### Existing tests — no changes required

All existing tests in `openings-state-transitions.spec.ts` that call `approveOpening` either:

- Use the superadmin token to submit (opening goes directly to `published`, bypassing `pending_review`) and then attempt to approve a `published` opening → 422 due to wrong state, not the new constraint.
- Use a no-role token to approve → blocked at 403 by middleware before reaching the SQL constraint.

No existing passing test will break.
