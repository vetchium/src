# T03 Orgs API for drafts and working copies

Requirements: OPN-GEN-001 to OPN-GEN-005, OPN-CNT-002, OPN-TEAM-001 to
OPN-TEAM-004, OPN-AUTH-002, OPN-AUTH-003, OPN-AUTH-006, OPN-LIFE-004,
OPN-WC-001, OPN-WC-002, OPN-WC-004 to OPN-WC-006, OPN-QTA-001 to
OPN-QTA-004, OPN-ORG-001 (except the request filters, which are T04),
OPN-ORG-002, the Problem types table.

Guides: `typespec.md`, `go.md`, `backend.md`, `database.md`,
`authorization.md`, `orgs.md`, `org-subscriptions.md`, `playwright.md`,
`verification.md`.

Exemplars: `typespec/orgs/users/invitations.tsp` and its companions
(idempotency headers and bindings); `typespec/orgs/users/management.tsp`
(list filters, keyset pagination, summary); `typespec/problem/orgs/users.*`;
`backend/handlers/orgs/users/invitations.go` and `management.go`;
`backend/internal/db/queries/org_invitations.sql` (`LockOrgSeatPolicy`, CTE
with audit) and `org_users.sql`; `backend/internal/idempotency/`;
`backend/internal/routes/orgs_routes.go`; `playwright/api/orgs-invitations.spec.ts`.

## Contract

Add `typespec/orgs/openings/{types,openings}.tsp` with Go and TS companions,
`typespec/problem/orgs/openings.*`, and import them from
`typespec/orgs/orgs.tsp`. Every write takes `Idempotency-Key` (24 h replay,
bound to the Org user, as invitations are). Identify Org users by email.

- `OrgOpening`: `opening_number`, `state`, `version`, `revision`,
  `live_content?`, `working_content?` (both `OpeningContent` from T01),
  `pending_request?` (`kind`, `requested_by_email`, `requested_at`,
  `note?`), `hiring_manager?` and `recruiter?` (`email`, `active`),
  `team_members` (same shape), `internal_notes?`, `created_by_email`,
  `created_at`, `updated_at`, `first_published_at?`, `expires_at?`,
  `last_revised_at?`, `ended_at?`.
- `OrgOpeningSummary` for lists: number, state, title (working title for a
  draft, live title otherwise), employing country, work arrangement,
  employment type, hiring manager and recruiter emails, pending request
  kind, `updated_at`, `expires_at?`.
- Operations under `/api/orgs/`:
  - `create-opening` → `201 OrgOpening`: `content`, `hiring_manager_email?`,
    `recruiter_email?`, `team_member_emails` (≤20), `internal_notes?`.
  - `duplicate-opening` → `201 OrgOpening`: `opening_number`.
  - `get-opening` → `OrgOpening`: `opening_number`.
  - `list-openings`: filters `states` (default every state but
    `discarded`), `hiring_manager_email`, `recruiter_email`,
    `employing_country`, `work_arrangement`, `employment_type`,
    `title_query` (≥2 characters, case-insensitive substring),
    `pagination_key`, `limit` (≤100); newest `updated_at` first, number as
    tie-breaker.
  - `opening-summary`: count per state and quota `{limit, used,
    window_start}` (OPN-QTA-004).
  - `save-opening-working-copy` → `OrgOpening`: `opening_number`,
    `version`, `content` (replaces the whole working copy; creates one from
    the live content's values when a published or paused Opening has none).
  - `discard-opening-working-copy`: `opening_number`, `version` (revision
    copies only).
  - `set-opening-team` → `OrgOpening`: `opening_number`, `version`,
    `hiring_manager_email?`, `recruiter_email?`, `team_member_emails`,
    `internal_notes?` (OPN-TEAM-003; refused in `closed`, `expired`,
    `discarded`).
  - `discard-opening`: `opening_number`, `version` (drafts with no pending
    request only; OPN-WC-005).
  - `list-opening-history`: `opening_number`, `pagination_key`, `limit`;
    entries carry action, actor email (absent for the system), request kind
    and notes when linked, `source_opening_number`, `created_at`.
- Problems: `org-opening-not-found` 404, `org-opening-version-conflict`
  409, `org-opening-request-pending` 409, `org-opening-state-conflict` 409,
  `org-opening-hiring-team-invalid` 422 (lists the offending addresses),
  `org-openings-quota-exceeded` 409 (`quota`, `count`), plus the existing
  validation, idempotency, auth, suspension, and permission problems.

## Backend

- Routes: reads (`get-opening`, `list-openings`, `opening-summary`,
  `list-opening-history`) use Org auth and `RequireActiveOrg` only; the
  query decides visibility: effective `org:view_openings` (read
  `org_effective_permissions` in SQL) or being the hiring manager,
  recruiter, or a team member. Anything else is `org-opening-not-found` or
  an empty list. Writes add `RequireOrgPermission(ManageOpenings)`.
- Create and duplicate: one transaction; lock the Org row in its own
  statement (`plan`, `next_opening_number`), then one CTE statement that
  checks `entitlements.CanCreate` input (count of `org_openings` with
  `created_at > WindowStart(now)`), increments the counter, inserts the
  Opening, its working content, team rows, a `created` or `duplicated`
  history entry, and the audit event. Replays take no new slot. Use
  `entitlements.OpeningQuota`; rename nothing there.
- Every other write is one statement guarded by `org_did`, number,
  `version`, and state; bump `version` and `updated_at`; append history
  (except content saves) and audit. Zero rows: re-read to choose between
  not-found, version-conflict, request-pending, and state-conflict.
- Validate content with the T01 validator before the statement; resolve
  team emails to active users of the same Org in the statement and refuse
  with `org-opening-hiring-team-invalid` when any is missing.
- Audit payloads hold number, action, version, and changed field names,
  never description, notes, or salary values (OPN-GEN-004).

## Tests

Playwright `playwright/api/orgs-openings.spec.ts` (split if long), each
test with its own `uniqueOrgDomain()` and `cleanupOrg`:
every operation's success and every declared problem; permission matrix
(no access, hiring-team-only reader, view, manage, superadmin); suspended
Org refused; quota at the edge with Free's 25 (set up the 24 earlier rows
with `orgSQL` if creating 25 through the API is slow) including concurrent
creates for the last slot, discarded drafts still counting, and replays not
consuming slots; version conflicts; idempotent replay and key conflict;
audit events for each write without content values. Go unit tests for
handler branches Playwright cannot reach.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, the new spec against
`make test-environment`, then `make test`.
