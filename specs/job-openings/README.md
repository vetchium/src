## Stage 1: Requirements

Status: DRAFT
Authors: @psankar
Dependencies: company-addresses (every opening references one or more active org addresses), cost-centers (optional cost-center reference), org tags (optional skill/topic tags), org-users (hiring manager / recruiter / hiring team / watchers must be active OrgUsers in the same org)
Future specs: hub-job-discovery (HubUser browse/search/view openings — role: `hub:apply_jobs`), hub-job-applications (HubUser apply flow + endorsements from connected colleagues — relies on hub-connections and hub-employer-ids, both drafted)

### Overview

Job Openings let OrgUsers create and publish job postings on the Vetchium platform. Each opening goes through an intra-org approval flow (Draft → Pending Review → Published) before becoming visible to HubUsers. A hiring manager and a recruiter — both active OrgUsers in the same org — must be assigned at creation time. An optional list of hiring-team members (potential team-mates) and watchers (passive observers) may also be attached. Openings reference one or more pre-defined org addresses from the company-addresses spec, with the work-location type indicating whether the role is on-site, hybrid, or remote.

Openings automatically expire 180 days after first publication; the `expired` state blocks new applications while allowing candidates already in the pipeline to complete their process. A regional background worker handles this transition. Once an opening leaves `draft`, its content is frozen — to change a published opening, the org must close it and create a new one (the duplicate flow is provided to seed the new draft).

An opening can be marked `is_internal` at creation time, making it visible only to OrgUsers (an internal job board, not surfaced on the Hub). This flag is immutable after the draft is created.

This spec covers only opening creation and lifecycle management on the Org portal. Hub-side discovery (search, browse, URL design), the HubUser application process, endorsements from connected colleagues, candidacy/interviews/offers, and any cross-region notification of marketplace staffing providers are deferred to their own specs. No marketplace coupling exists in Phase 1 — providers will discover openings through the (future) hub-discovery surface.

Portals affected: Org portal (full lifecycle). All write operations are initiated by OrgUsers. Openings live in the org's home region; cross-region read access (when a HubUser in region A views an opening posted by an org in region B) is the responsibility of the future hub-discovery spec, not this one.

### Key Concepts and Vocabulary

- **Opening** — a single job posting created by an org. Identified internally by `opening_id` (UUID) and externally by the composite `(org_domain, opening_number)` where `opening_number` is a per-org atomic counter starting at 1.
- **Hiring manager** — the OrgUser ultimately accountable for the hire (typically the team lead). Required, single.
- **Recruiter** — the OrgUser running the talent-acquisition pipeline (typically TA/HR). Required, single.
- **Hiring team member** — an OrgUser who is a potential future team-mate of the candidate, listed for visibility and (later) for endorsement-trust signals. Optional, 0..10.
- **Watcher** — an OrgUser who receives notifications about opening / pipeline events but has no decision rights. Optional, 0..25.
- **Address** — a pre-defined, active entry in the org's address book (see company-addresses spec). Every opening references 1..10 addresses regardless of work-location type; the address `country` field acts as the legal-jurisdiction signal. For a fully-remote role this is typically the org's registered office(s).
- **Internal opening** — an opening with `is_internal = true`; visible only to OrgUsers in the same org; never surfaced on the Hub.
- **Cost center** — an optional reference to an org cost center used for internal budget tracking.
- **Tags** — optional discovery/skill labels chosen from the platform-wide tag catalog.

### Opening State Machine

States: `DRAFT`, `PENDING_REVIEW`, `PUBLISHED`, `PAUSED`, `EXPIRED`, `CLOSED`, `ARCHIVED`. `ARCHIVED` is the terminal state (only `duplicate-opening` is permitted from there). A `DRAFT` may also be hard-deleted via `discard-opening`, leaving no row.

| From           | Action / Trigger                                 | Required role                        | To             | Notes                                                                                                               |
| -------------- | ------------------------------------------------ | ------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| —              | `create-opening`                                 | `org:manage_openings`                | DRAFT          | New row, allocates `opening_number`                                                                                 |
| DRAFT          | `update-opening`                                 | `org:manage_openings`                | DRAFT          | Replaces all editable fields (PUT semantics); `is_internal` immutable                                               |
| DRAFT          | `discard-opening`                                | `org:manage_openings`                | (deleted)      | Hard-deletes the row + junction rows; allowed only on DRAFT                                                         |
| DRAFT          | `submit-opening` (caller is non-superadmin)      | `org:manage_openings`                | PENDING_REVIEW | Audit: `org.submit_opening`                                                                                         |
| DRAFT          | `submit-opening` (caller holds `org:superadmin`) | `org:superadmin`                     | PUBLISHED      | Sets `first_published_at`; audit: `org.publish_opening` with `via='submit_superadmin'`                              |
| PENDING_REVIEW | `approve-opening`                                | `org:manage_openings`                | PUBLISHED      | Sets `first_published_at`; audit: `org.publish_opening` with `via='approve'`                                        |
| PENDING_REVIEW | `reject-opening` (with `rejection_note`)         | `org:manage_openings`                | DRAFT          | Stores `rejection_note` on opening; opening becomes editable again                                                  |
| PUBLISHED      | `pause-opening`                                  | `org:manage_openings`                | PAUSED         | 180-day expiry clock continues during PAUSED                                                                        |
| PAUSED         | `reopen-opening`                                 | `org:manage_openings`                | PUBLISHED      | 422 if `first_published_at + 180d <= NOW()` (worker will sweep to EXPIRED)                                          |
| PUBLISHED      | `close-opening`                                  | `org:manage_openings`                | CLOSED         | Closed openings cannot be reopened                                                                                  |
| PAUSED         | `close-opening`                                  | `org:manage_openings`                | CLOSED         | Same                                                                                                                |
| PUBLISHED      | regional `expire_openings_worker` (auto)         | n/a (worker, `actor_user_id = NULL`) | EXPIRED        | When `first_published_at + 180d <= NOW()`                                                                           |
| PAUSED         | regional `expire_openings_worker` (auto)         | n/a (worker, `actor_user_id = NULL`) | EXPIRED        | Same                                                                                                                |
| CLOSED         | `archive-opening`                                | `org:manage_openings`                | ARCHIVED       | Terminal-pending-archive becomes terminal                                                                           |
| EXPIRED        | `archive-opening`                                | `org:manage_openings`                | ARCHIVED       | Same                                                                                                                |
| any state      | `duplicate-opening`                              | `org:manage_openings`                | (new DRAFT)    | Source row unchanged; clone gets fresh `opening_id`, `opening_number`, no `rejection_note`, no `first_published_at` |

Disallowed (return 422): any other transition, including `update-opening` on a non-DRAFT opening, `submit-opening` from a non-DRAFT state, `approve-opening` / `reject-opening` from any state other than PENDING_REVIEW, `reopen-opening` from a non-PAUSED state or after the 180-day clock has elapsed, and `archive-opening` from anything other than CLOSED or EXPIRED.

Notes:

- **Edit policy**: an opening's content can be edited any number of times while in `DRAFT`. Once it leaves `DRAFT`, its content is frozen forever — even after a reject-back-to-draft cycle the opening returns to `DRAFT` and is fully editable again. There is no field-level "edit while published" exception. To change a published opening's content, the org closes it and creates a new opening (the `duplicate` action seeds the new draft from the old fields).
- **Reviewer-driven edits**: a reviewer who wants changes must `reject` with a note; the opening returns to `DRAFT` for the original author to edit. There is no submitter-side `withdraw` from `PENDING_REVIEW` — the reviewer is always the actor that resolves a pending review.
- **Discard**: only a `DRAFT` opening can be hard-deleted via `discard-opening`. The opening row, its junction-table associations (addresses, tags, hiring-team, watchers), and any pending audit-log lookups remain on the audit_logs table (audit logs intentionally have no FK constraints) but the opening row itself is removed. Non-draft openings are never deleted; the terminal end-state is `ARCHIVED`.
- **Pause**: a `PUBLISHED` opening can be paused; the 180-day expiry clock continues to tick during `PAUSED`. Pausing does not extend lifespan. A paused opening is hidden from the Hub but kept in the org's list.
- **Reopen**: a `PAUSED` opening can be moved back to `PUBLISHED` (provided the 180-day clock has not run out — if it has, the worker will move it to `EXPIRED` instead). Reopening does NOT reset `first_published_at`.
- **Close**: an explicit org action; allowed from `PUBLISHED` or `PAUSED`. Closed openings cannot be reopened — the org must duplicate-and-republish if they want to re-post.
- **Expire**: a regional background worker (`expire_openings_worker`) runs daily; for each opening where `status IN ('published','paused')` AND `first_published_at + 180 days <= NOW()`, it moves the opening to `EXPIRED` and writes one audit-log entry per row with `actor_user_id = NULL` and `event_type = 'org.expire_opening'`.
- **Archive**: an explicit org action allowed from `CLOSED` or `EXPIRED`. Archived openings are kept for historical reference and can be `duplicate`-d but otherwise immutable.
- **Duplicate**: allowed from any state including `ARCHIVED`. Creates a new opening row in `DRAFT` state with a new `opening_id` and a new `opening_number`, copying all editable fields (including `is_internal`, addresses, hiring team, watchers, tags, cost center, salary, etc.) from the source. The duplicate's `first_published_at` is null until it is itself published.

### Acceptance Criteria

#### Creation and edit (Draft)

- [ ] OrgUser with `org:manage_openings` can create a new opening; it starts in `draft` state with a freshly-allocated `opening_number` (per-org atomic counter starting at 1).
- [ ] Required fields at creation: `title`, `description`, `is_internal`, `employment_type`, `work_location_type`, `address_ids[]` (1..10), `number_of_positions`, `hiring_manager_org_user_id`, `recruiter_org_user_id`.
- [ ] Optional fields: `min_yoe`, `max_yoe` (when both present, `max_yoe >= min_yoe`), `min_education_level`, `salary` (a `{ min_amount, max_amount, currency }` object — when present, `max_amount >= min_amount > 0` and currency is a 3-char ISO 4217 code), `cost_center_id`, `tag_ids[]` (max 20), `hiring_team_member_ids[]` (max 10), `watcher_ids[]` (max 25), `internal_notes` (max 2000 chars, never returned on hub-side endpoints).
- [ ] Every referenced address must be active and belong to the same org; `address_ids[]` length is 1..10 regardless of `work_location_type`.
- [ ] Every referenced OrgUser (hiring manager, recruiter, hiring-team-members, watchers) must be active and belong to the same org. The hiring manager, recruiter, and each hiring-team-member must be a distinct user; watchers may overlap with any other role.
- [ ] If `cost_center_id` is provided it must be an active cost center belonging to the same org.
- [ ] If `tag_ids[]` are provided each must exist in the global tag catalog and have status = active.
- [ ] `is_internal` is set at creation and is immutable; `is_internal = true` openings are never surfaced to HubUsers (enforced both at the future Hub endpoint and as a precondition for marketplace-style cross-org notifications, which are deferred).
- [ ] OrgUser with `org:manage_openings` can call `update-opening` to replace any editable field on a `draft` opening (except `is_internal`); the call replaces all editable fields, not a subset (PUT semantics).
- [ ] Editing is rejected with 422 once the opening leaves `draft`, even after a reject-to-draft cycle (the cycle returns the opening to `draft`, where `update-opening` is allowed again — the 422 only applies in non-draft states).
- [ ] OrgUser with `org:manage_openings` can call `discard-opening` on a `draft` opening; the opening row and its junction-table associations are hard-deleted in one transaction. Audit log entry for `org.discard_opening` is written in the same transaction before the delete.

#### Submission and review

- [ ] OrgUser with `org:manage_openings` can call `submit-opening` on a `draft` opening. If the submitter holds `org:superadmin`, the opening transitions directly to `published`, `first_published_at` is set, and `org.publish_opening` is logged. Otherwise it transitions to `pending_review` and `org.submit_opening` is logged.
- [ ] OrgUser with `org:manage_openings` can call `approve-opening` on a `pending_review` opening, transitioning it to `published`. `first_published_at` is set on this transition. The approver may be the same user as the submitter only when the submitter is also the org's superadmin (in which case they would have skipped review entirely).
- [ ] OrgUser with `org:manage_openings` can call `reject-opening` on a `pending_review` opening with a required `rejection_note` (max 2000 chars); the opening returns to `draft` and `rejection_note` is stored on the opening (overwriting any prior rejection note). The note is shown on the detail page when the opening is back in `draft` so the author knows what to fix.

#### Lifecycle on a Published opening

- [ ] OrgUser with `org:manage_openings` can `pause-opening` a `published` opening → `paused` (hidden from Hub). The 180-day clock continues during `paused`.
- [ ] OrgUser with `org:manage_openings` can `reopen-opening` a `paused` opening → `published`. If `first_published_at + 180d <= NOW()` the call is rejected with 422 (the worker will sweep it to `expired` shortly).
- [ ] OrgUser with `org:manage_openings` can `close-opening` a `published` or `paused` opening → `closed`. Closed openings cannot be reopened.
- [ ] A `published` or `paused` opening is automatically moved to `expired` by the regional `expire_openings_worker` 180 days after `first_published_at`. The worker runs at least daily, processes openings in batches, and writes one audit-log entry per opening with `actor_user_id = NULL` and `event_type = 'org.expire_opening'` inside the same transaction as the state change.
- [ ] Expired openings accept no new applications but allow existing pipeline candidates to continue (this is enforced by the future applications spec; this spec only sets the state).
- [ ] OrgUser with `org:manage_openings` can `archive-opening` a `closed` or `expired` opening → `archived`. Archive is the terminal state; only `duplicate-opening` is allowed afterwards.
- [ ] OrgUser with `org:manage_openings` can `duplicate-opening` from any state (including `archived`); a new opening is created in `draft` with a new `opening_id` and new `opening_number`, copying all editable fields from the source. `is_internal` is copied; the duplicate's `first_published_at` is null until it is itself published. The duplicate's `rejection_note` is cleared.

#### filled_positions

- [ ] The `openings` table has a `filled_positions` integer column (default 0). It is **not writable in Phase 1** — no API mutates it. The future offers/hire spec will increment it. The column exists now so that the schema is stable and the field is available on read-side responses for downstream use.

#### Read endpoints and pagination

- [ ] OrgUser with `org:view_openings` can call `list-openings` and `get-opening` (read-only). All write endpoints listed above require `org:manage_openings`; `org:superadmin` bypasses all role checks.
- [ ] `list-openings` supports filtering by status (single status or array), by `is_internal` (bool), by `hiring_manager_org_user_id`, by `recruiter_org_user_id`, by `tag_ids[]` (any-match), and by free-text title prefix. It uses keyset pagination on `(created_at DESC, opening_number DESC)`; cursor encodes both.
- [ ] `get-opening` is keyed by `opening_number` (the org is implied by the caller's session); it returns the full opening including `internal_notes`, all referenced addresses (denormalized), all referenced OrgUsers (denormalized to short-form), tags (denormalized), cost-center, and `rejection_note` if present.

#### Auditing and RBAC

- [ ] An audit-log entry is written inside the same transaction as every state-changing operation. Event types: `org.create_opening`, `org.update_opening`, `org.discard_opening`, `org.duplicate_opening`, `org.submit_opening`, `org.publish_opening` (superadmin direct-publish at submit-time, and approve-driven publish), `org.reject_opening`, `org.pause_opening`, `org.reopen_opening`, `org.close_opening`, `org.archive_opening`, `org.expire_opening`. The expire event uses `actor_user_id = NULL`. Every other event records the calling OrgUser as actor.
- [ ] New roles `org:view_openings` and `org:manage_openings` are defined in `specs/typespec/common/roles.ts`, `specs/typespec/common/roles.go`, and the regional `initial_schema.sql` `roles` seed.

### Field Constraints

| Field                        | Type                                                   | Required         | Constraints                                                                      |
| ---------------------------- | ------------------------------------------------------ | ---------------- | -------------------------------------------------------------------------------- |
| `title`                      | string                                                 | yes              | 1..200 chars                                                                     |
| `description`                | string                                                 | yes              | 1..10000 chars                                                                   |
| `is_internal`                | bool                                                   | yes (immutable)  | true / false                                                                     |
| `employment_type`            | enum                                                   | yes              | `full_time` / `part_time` / `contract` / `internship`                            |
| `work_location_type`         | enum                                                   | yes              | `remote` / `on_site` / `hybrid`                                                  |
| `address_ids[]`              | UUID[]                                                 | yes              | 1..10 entries; each must be an active org address belonging to the caller's org  |
| `min_yoe`                    | int                                                    | no               | 0..100                                                                           |
| `max_yoe`                    | int                                                    | no               | 1..100; if `min_yoe` also present, `max_yoe >= min_yoe`                          |
| `min_education_level`        | enum                                                   | no               | `not_required` / `bachelor` / `master` / `doctorate`                             |
| `salary`                     | `{min_amount: decimal, max_amount: decimal, currency}` | no               | `min_amount > 0`; `max_amount >= min_amount`; `currency` 3-char ISO 4217         |
| `number_of_positions`        | int                                                    | yes              | 1..100                                                                           |
| `filled_positions`           | int                                                    | (read-only)      | 0..number_of_positions; never set by Phase 1 endpoints                           |
| `hiring_manager_org_user_id` | UUID                                                   | yes              | active OrgUser in same org                                                       |
| `recruiter_org_user_id`      | UUID                                                   | yes              | active OrgUser in same org                                                       |
| `hiring_team_member_ids[]`   | UUID[]                                                 | no               | 0..10 entries; each active and same org; distinct from manager and recruiter     |
| `watcher_ids[]`              | UUID[]                                                 | no               | 0..25 entries; each active and same org; may overlap with manager/recruiter/team |
| `cost_center_id`             | UUID                                                   | no               | active cost center, same org                                                     |
| `tag_ids[]`                  | string[]                                               | no               | 0..20 entries; each must be an active tag in the global catalog                  |
| `internal_notes`             | string                                                 | no               | 0..2000 chars; never returned on hub-side endpoints                              |
| `rejection_note`             | string                                                 | (system-managed) | 0..2000 chars; written by `reject-opening`; cleared on next successful submit    |

### User-Facing Screens

**Screen: Opening List (Org)**

Portal: org-ui | Route: `/openings`

Header: Back to Dashboard button | "Job Openings" title (h2) | "Create Opening" button (right, hidden if user lacks `org:manage_openings`).

Filters (in a single row above the table):

- Status: multi-select — Draft / Pending Review / Published / Paused / Expired / Closed / Archived (default: all non-archived).
- Visibility: All / Public / Internal.
- Hiring Manager: searchable picker (lists active OrgUsers).
- Recruiter: searchable picker (lists active OrgUsers).
- Tags: multi-select.
- Title prefix: free-text input.

| # (opening_number) | Title | Visibility (Public / Internal) | Status | Hiring Manager | Recruiter | Employment Type | Work Location | Positions (filled / total) | Created At | Actions |
| ------------------ | ----- | ------------------------------ | ------ | -------------- | --------- | --------------- | ------------- | -------------------------- | ---------- | ------- |

Actions column renders contextually (always conditional on `org:manage_openings`):

- DRAFT → View · Edit · Submit · Discard · Duplicate
- PENDING_REVIEW → View · Approve · Reject · Duplicate
- PUBLISHED → View · Pause · Close · Duplicate
- PAUSED → View · Reopen · Close · Duplicate
- EXPIRED → View · Archive · Duplicate
- CLOSED → View · Archive · Duplicate
- ARCHIVED → View · Duplicate

Read-only role (`org:view_openings`) sees only the View action.

Empty state: _"No openings yet. Click 'Create Opening' to post your first role."_ — with the button hidden when the user lacks manage permission.

**Screen: Create Opening**

Triggered by: "Create Opening" button on list page | Portal: org-ui | Route: `/openings/new`

> **Note:** Once submitted and approved, an opening's content is frozen. To change a published opening you must close it and create a new one (use Duplicate to copy the fields). Published openings are automatically expired 180 days after first publication.

| Field                  | Type                           | Constraints                                                                            |
| ---------------------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| Title                  | text                           | required, 1..200 chars                                                                 |
| Description            | rich textarea                  | required, 1..10000 chars                                                               |
| Internal Opening       | checkbox                       | immutable after creation; if checked, visible only to OrgUsers                         |
| Employment Type        | select                         | required — `full_time` / `part_time` / `contract` / `internship`                       |
| Work Location Type     | select                         | required — `remote` / `on_site` / `hybrid`                                             |
| Addresses              | multi-select                   | required, 1..10 entries; populated from the org's active addresses                     |
| Min Experience (years) | number                         | optional, 0..100                                                                       |
| Max Experience (years) | number                         | optional, 1..100, `>= min`                                                             |
| Min Education Level    | select                         | optional — `not_required` / `bachelor` / `master` / `doctorate`                        |
| Salary — Min Amount    | number                         | optional; required if any salary field is present                                      |
| Salary — Max Amount    | number                         | optional; required if any salary field is present, `>= min`                            |
| Salary — Currency      | text                           | optional; required if any salary field is present; ISO 4217, 3 chars                   |
| Number of Positions    | number                         | required, 1..100                                                                       |
| Hiring Manager         | select (single)                | required — active OrgUser, same org                                                    |
| Recruiter              | select (single)                | required — active OrgUser, same org                                                    |
| Hiring Team Members    | multi-select                   | optional, 0..10; active OrgUsers, same org; distinct from hiring manager and recruiter |
| Watchers               | multi-select                   | optional, 0..25; active OrgUsers, same org                                             |
| Cost Center            | select                         | optional, populated from active org cost centers                                       |
| Tags / Skills          | multi-select with autocomplete | optional, 0..20                                                                        |
| Internal Notes         | textarea                       | optional, 0..2000 chars; never visible to HubUsers                                     |

Submit button: "Save as Draft". On success the user lands on the Opening Detail page.

**Screen: Opening Detail (Org)**

Portal: org-ui | Route: `/openings/:opening_number`

Displays all opening fields in read mode plus a sidebar showing:

- `opening_number` and shareable composite identifier `(org_domain, opening_number)` — copied as `org.example.com / 42`.
- Status with state-machine-aware badge.
- Visibility: Public / Internal.
- Created at, last updated at, first published at (if any).
- Rejection note (only when in `draft` after a prior reject; rendered as a yellow banner above the form: _"Returned for changes by {approver_name}: {rejection_note}"_).
- Banners by status:
  - PUBLISHED → _"This opening will be automatically expired on {first_published_at + 180d}."_
  - PAUSED → _"This opening is paused and hidden from the Hub. The 180-day expiry clock is still running and will fire on {first_published_at + 180d}."_
  - EXPIRED → _"This opening expired automatically on {expired_at} and no longer accepts new applications."_

Action buttons (rendered contextually by status and role; only visible to users with `org:manage_openings`):

- DRAFT → Edit · Submit for Review · Discard · Duplicate
- PENDING_REVIEW → Approve · Reject (opens a modal to enter rejection note) · Duplicate
- PUBLISHED → Pause · Close · Duplicate
- PAUSED → Reopen · Close · Duplicate
- EXPIRED → Archive · Duplicate
- CLOSED → Archive · Duplicate
- ARCHIVED → Duplicate only

**Screen: Edit Opening**

Portal: org-ui | Route: `/openings/:opening_number/edit`

Same form as Create Opening, pre-populated. Available only when status is `draft`. Saving replaces all editable fields. The `Internal Opening` checkbox is shown but disabled (read-only) — it cannot be changed after creation. Visiting this URL for a non-draft opening returns 422 from the API and renders an inline error _"This opening is no longer editable. Close it and create a new one to make changes."_

### API Surface

| Endpoint                      | Portal | Who calls it              | What it does                                                                         |
| ----------------------------- | ------ | ------------------------- | ------------------------------------------------------------------------------------ |
| `POST /org/create-opening`    | org    | OrgUser (manage_openings) | Creates a new opening in `draft` state, allocates `opening_number`                   |
| `POST /org/list-openings`     | org    | OrgUser (view_openings)   | Paginates openings for the caller's org; supports filters listed above               |
| `POST /org/get-opening`       | org    | OrgUser (view_openings)   | Gets a single opening by `opening_number`, including denormalized references         |
| `POST /org/update-opening`    | org    | OrgUser (manage_openings) | Replaces all editable fields on a `draft` opening; 422 if not in `draft`             |
| `POST /org/discard-opening`   | org    | OrgUser (manage_openings) | Hard-deletes a `draft` opening + junction rows; 422 if not in `draft`                |
| `POST /org/duplicate-opening` | org    | OrgUser (manage_openings) | Creates a new `draft` clone of any opening (any state) with a new `opening_number`   |
| `POST /org/submit-opening`    | org    | OrgUser (manage_openings) | `draft` → `pending_review` (or `published` directly when caller is `org:superadmin`) |
| `POST /org/approve-opening`   | org    | OrgUser (manage_openings) | `pending_review` → `published`; sets `first_published_at`                            |
| `POST /org/reject-opening`    | org    | OrgUser (manage_openings) | `pending_review` → `draft`; stores `rejection_note` on the opening                   |
| `POST /org/pause-opening`     | org    | OrgUser (manage_openings) | `published` → `paused`                                                               |
| `POST /org/reopen-opening`    | org    | OrgUser (manage_openings) | `paused` → `published`; 422 if 180-day clock has elapsed                             |
| `POST /org/close-opening`     | org    | OrgUser (manage_openings) | `published` or `paused` → `closed`                                                   |
| `POST /org/archive-opening`   | org    | OrgUser (manage_openings) | `closed` or `expired` → `archived`                                                   |

Notes:

- The `expired` transition is **not** a user-callable endpoint — it is performed exclusively by the regional `expire_openings_worker`, which writes the audit-log entry with `actor_user_id = NULL`.
- All requests use `opening_number` (an `int32`, per-org counter) to identify the opening; the org is implicit from the caller's session.
- All endpoints require `OrgAuth` plus the role listed; `org:superadmin` bypasses role checks.
- Hub-side read endpoints (`/hub/list-openings`, `/hub/get-opening`) are deferred to the Hub Job Discovery spec. When defined, the correct role for HubUsers browsing openings is `hub:apply_jobs` (not `hub:read_posts`, which covers social/blog content). Internal openings (`is_internal = true`) must be excluded from those endpoints.

### Audit Log Events

| event_type              | when                                                  | actor_user_id | event_data keys                                                                               |
| ----------------------- | ----------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------- |
| `org.create_opening`    | create-opening success                                | calling user  | `opening_id`, `opening_number`, `title`, `is_internal`                                        |
| `org.update_opening`    | update-opening success                                | calling user  | `opening_id`, `opening_number`                                                                |
| `org.discard_opening`   | discard-opening success                               | calling user  | `opening_id`, `opening_number`, `title`                                                       |
| `org.duplicate_opening` | duplicate-opening success                             | calling user  | `opening_id`, `opening_number`, `source_opening_id`                                           |
| `org.submit_opening`    | submit-opening when submitter is non-superadmin       | calling user  | `opening_id`, `opening_number`                                                                |
| `org.publish_opening`   | submit-opening (superadmin direct-publish) OR approve | calling user  | `opening_id`, `opening_number`, `first_published_at`, `via` ('submit_superadmin' / 'approve') |
| `org.reject_opening`    | reject-opening success                                | calling user  | `opening_id`, `opening_number`, `rejection_note`                                              |
| `org.pause_opening`     | pause-opening success                                 | calling user  | `opening_id`, `opening_number`                                                                |
| `org.reopen_opening`    | reopen-opening success                                | calling user  | `opening_id`, `opening_number`                                                                |
| `org.close_opening`     | close-opening success                                 | calling user  | `opening_id`, `opening_number`                                                                |
| `org.archive_opening`   | archive-opening success                               | calling user  | `opening_id`, `opening_number`                                                                |
| `org.expire_opening`    | expire_openings_worker run                            | NULL          | `opening_id`, `opening_number`, `expired_at`                                                  |

All entries land in the regional `audit_logs` table inside the same transaction as the state change. No raw email addresses are recorded; opening IDs and numbers only.

### Out of Scope for Phase 1 (deferred to other specs)

- Hub-side discovery (search, browse, view-detail). Future spec: `hub-job-discovery`.
- Hub-side application flow including endorsements from connected colleagues. Future spec: `hub-job-applications`. Endorsements depend on `hub-connections` and `hub-employer-ids` (both drafted at `specs/hub-connections/README.md` and `specs/hub-employer-ids/README.md`); the trust model — only ex-colleagues with overlapping verified tenure at a shared employer can endorse — is owned by that future spec, not by job-openings.
- Marketplace-style staffing-provider notification on publish. Removed from this spec; will be reintroduced as its own small spec once the notification channel and recipient targeting are nailed down. The current marketplace-v2 spec's capabilities are an admin-managed catalog; opening-side coupling should not hard-code any specific capability.
- Application pipeline (color tags, shortlist, reject), candidacy, interviews, offers, and `filled_positions` increments.
- Application count badges on the org's opening list. (Counts come from the applications table; spec'd in `hub-job-applications`.)
- Auto-archive of CLOSED/EXPIRED openings after a grace period. Manual archive only in Phase 1.

---

## Stage 2: Implementation Plan

Status: READY-FOR-IMPLEMENTATION
Authors: @psankar

### API Contract

TypeSpec definitions in `specs/typespec/org/openings.tsp` with matching `.ts` and `.go` files. Cross-namespace references: `OrgAddress` from `org/company-addresses`, `OrgUserShort` from `org/org-users`, `CostCenter` from `org/cost-centers`, `OrgTag` from `org/tags`.

```typespec
// specs/typespec/org/openings.tsp

union OpeningStatus {
  Draft:          "draft",
  PendingReview:  "pending_review",
  Published:      "published",
  Paused:         "paused",
  Expired:        "expired",
  Closed:         "closed",
  Archived:       "archived",
}

union EmploymentType {
  FullTime:   "full_time",
  PartTime:   "part_time",
  Contract:   "contract",
  Internship: "internship",
}

union WorkLocationType {
  Remote: "remote",
  OnSite: "on_site",
  Hybrid: "hybrid",
}

union EducationLevel {
  NotRequired: "not_required",
  Bachelor:    "bachelor",
  Master:      "master",
  Doctorate:   "doctorate",
}

model Salary {
  min_amount: decimal;
  max_amount: decimal;
  currency:   string;     // ISO 4217, 3 chars
}

model CreateOpeningRequest {
  title:                       string;
  description:                  string;
  is_internal:                  boolean;
  employment_type:              EmploymentType;
  work_location_type:           WorkLocationType;
  address_ids:                  string[];     // 1..10
  min_yoe?:                     int32;
  max_yoe?:                     int32;
  min_education_level?:         EducationLevel;
  salary?:                      Salary;
  number_of_positions:          int32;
  hiring_manager_org_user_id:   string;
  recruiter_org_user_id:        string;
  hiring_team_member_ids?:      string[];     // 0..10
  watcher_ids?:                 string[];     // 0..25
  cost_center_id?:              string;
  tag_ids?:                     string[];     // 0..20
  internal_notes?:              string;       // 0..2000
}

model CreateOpeningResponse {
  opening_id:     string;
  opening_number: int32;
}

model OpeningSummary {
  opening_id:                 string;
  opening_number:             int32;
  title:                      string;
  is_internal:                boolean;
  status:                     OpeningStatus;
  employment_type:            EmploymentType;
  work_location_type:         WorkLocationType;
  number_of_positions:        int32;
  filled_positions:           int32;
  hiring_manager:             OrgUserShort;
  recruiter:                  OrgUserShort;
  primary_address_city?:      string;        // first address.city for compact list rendering
  created_at:                 utcDateTime;
  first_published_at?:        utcDateTime;
}

model Opening {
  opening_id:                 string;
  opening_number:             int32;
  title:                      string;
  description:                string;
  is_internal:                boolean;
  status:                     OpeningStatus;
  employment_type:            EmploymentType;
  work_location_type:         WorkLocationType;
  addresses:                  OrgAddress[];   // denormalized
  min_yoe?:                   int32;
  max_yoe?:                   int32;
  min_education_level?:       EducationLevel;
  salary?:                    Salary;
  number_of_positions:        int32;
  filled_positions:           int32;
  hiring_manager:             OrgUserShort;
  recruiter:                  OrgUserShort;
  hiring_team_members:        OrgUserShort[];
  watchers:                   OrgUserShort[];
  cost_center?:               CostCenter;
  tags:                       OrgTag[];
  internal_notes?:            string;
  rejection_note?:            string;
  created_at:                 utcDateTime;
  updated_at:                 utcDateTime;
  first_published_at?:        utcDateTime;
}

model UpdateOpeningRequest {
  opening_number:               int32;
  // every field from CreateOpeningRequest except is_internal — replaces all editable fields
  title:                        string;
  description:                  string;
  employment_type:              EmploymentType;
  work_location_type:           WorkLocationType;
  address_ids:                  string[];
  min_yoe?:                     int32;
  max_yoe?:                     int32;
  min_education_level?:         EducationLevel;
  salary?:                      Salary;
  number_of_positions:          int32;
  hiring_manager_org_user_id:   string;
  recruiter_org_user_id:        string;
  hiring_team_member_ids?:      string[];
  watcher_ids?:                 string[];
  cost_center_id?:              string;
  tag_ids?:                     string[];
  internal_notes?:              string;
}

model OpeningNumberRequest { opening_number: int32; }
model RejectOpeningRequest { opening_number: int32; rejection_note: string; }

model ListOpeningsRequest {
  filter_status?:                     OpeningStatus[];
  filter_is_internal?:                boolean;
  filter_hiring_manager_org_user_id?: string;
  filter_recruiter_org_user_id?:      string;
  filter_tag_ids?:                    string[];
  filter_title_prefix?:               string;
  pagination_key?:                    string;
  limit?:                             int32;
}

model ListOpeningsResponse {
  openings:             OpeningSummary[];
  next_pagination_key?: string;
}

@route("/org/create-opening")    @post createOpening   (...CreateOpeningRequest):  CreatedResponse<CreateOpeningResponse> | BadRequestResponse;
@route("/org/list-openings")     @post listOpenings    (...ListOpeningsRequest):   OkResponse<ListOpeningsResponse>      | BadRequestResponse;
@route("/org/get-opening")       @post getOpening      (...OpeningNumberRequest):  OkResponse<Opening>                   | NotFoundResponse;
@route("/org/update-opening")    @post updateOpening   (...UpdateOpeningRequest):  OkResponse<Opening>                   | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/discard-opening")   @post discardOpening  (...OpeningNumberRequest):  NoContentResponse                     | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/duplicate-opening") @post duplicateOpening(...OpeningNumberRequest):  CreatedResponse<CreateOpeningResponse>| NotFoundResponse;
@route("/org/submit-opening")    @post submitOpening   (...OpeningNumberRequest):  OkResponse<Opening>                   | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/approve-opening")   @post approveOpening  (...OpeningNumberRequest):  OkResponse<Opening>                   | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/reject-opening")    @post rejectOpening   (...RejectOpeningRequest):  OkResponse<Opening>                   | BadRequestResponse | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/pause-opening")     @post pauseOpening    (...OpeningNumberRequest):  OkResponse<Opening>                   | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/reopen-opening")    @post reopenOpening   (...OpeningNumberRequest):  OkResponse<Opening>                   | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/close-opening")     @post closeOpening    (...OpeningNumberRequest):  OkResponse<Opening>                   | NotFoundResponse | UnprocessableEntityResponse;
@route("/org/archive-opening")   @post archiveOpening  (...OpeningNumberRequest):  OkResponse<Opening>                   | NotFoundResponse | UnprocessableEntityResponse;
```

The matching `.ts` and `.go` files mirror the TypeSpec one-to-one. Each writable request type exports a `validate{TypeName}` function returning `ValidationError[]`; per-field validators (e.g. `validateOpeningTitle`, `validateOpeningDescription`, `validateOpeningSalary`) live alongside.

Cross-namespace references in `.ts`:

- `import { OrgAddress } from "vetchium-specs/org/company-addresses";`
- `import { OrgUserShort } from "vetchium-specs/org/org-users";`
- `import { CostCenter } from "vetchium-specs/org/cost-centers";`
- `import { OrgTag } from "vetchium-specs/org/tags";`

In `.go`, import each from its corresponding package and cast at the boundary.

### Database Schema

Edits to `api-server/db/migrations/regional/00000000000001_initial_schema.sql`. No global-DB changes in Phase 1 (openings live entirely in regional DBs).

```sql
-- ENUM types
CREATE TYPE opening_status      AS ENUM ('draft','pending_review','published','paused','expired','closed','archived');
CREATE TYPE employment_type     AS ENUM ('full_time','part_time','contract','internship');
CREATE TYPE work_location_type  AS ENUM ('remote','on_site','hybrid');
CREATE TYPE education_level     AS ENUM ('not_required','bachelor','master','doctorate');

-- Per-org atomic counter for opening_number.
CREATE TABLE org_opening_counters (
  org_id                UUID    PRIMARY KEY,
  next_opening_number   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE openings (
  opening_id              UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID                NOT NULL,
  opening_number          INTEGER             NOT NULL,
  title                   VARCHAR(200)        NOT NULL,
  description             TEXT                NOT NULL,
  is_internal             BOOLEAN             NOT NULL,
  employment_type         employment_type     NOT NULL,
  work_location_type      work_location_type  NOT NULL,
  min_yoe                 INTEGER,
  max_yoe                 INTEGER,
  min_education_level     education_level,
  salary_min_amount       NUMERIC(20, 4),
  salary_max_amount       NUMERIC(20, 4),
  salary_currency         CHAR(3),
  number_of_positions     INTEGER             NOT NULL CHECK (number_of_positions >= 1),
  filled_positions        INTEGER             NOT NULL DEFAULT 0,
  hiring_manager_org_user_id UUID             NOT NULL,
  recruiter_org_user_id      UUID             NOT NULL,
  cost_center_id          UUID,
  internal_notes          TEXT,
  status                  opening_status      NOT NULL DEFAULT 'draft',
  rejection_note          TEXT,
  first_published_at      TIMESTAMPTZ,
  expired_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, opening_number),
  CHECK (filled_positions <= number_of_positions),
  CHECK ( (salary_min_amount IS NULL AND salary_max_amount IS NULL AND salary_currency IS NULL)
       OR (salary_min_amount IS NOT NULL AND salary_max_amount IS NOT NULL AND salary_currency IS NOT NULL))
);

CREATE TABLE opening_addresses (
  opening_id  UUID NOT NULL REFERENCES openings(opening_id) ON DELETE CASCADE,
  address_id  UUID NOT NULL,
  PRIMARY KEY (opening_id, address_id)
);

CREATE TABLE opening_hiring_team_members (
  opening_id      UUID NOT NULL REFERENCES openings(opening_id) ON DELETE CASCADE,
  org_user_id     UUID NOT NULL,
  PRIMARY KEY (opening_id, org_user_id)
);

CREATE TABLE opening_watchers (
  opening_id   UUID NOT NULL REFERENCES openings(opening_id) ON DELETE CASCADE,
  org_user_id  UUID NOT NULL,
  PRIMARY KEY (opening_id, org_user_id)
);

CREATE TABLE opening_tags (
  opening_id  UUID    NOT NULL REFERENCES openings(opening_id) ON DELETE CASCADE,
  tag_id      VARCHAR NOT NULL,
  PRIMARY KEY (opening_id, tag_id)
);

CREATE INDEX idx_openings_org_status_created ON openings (org_id, status, created_at DESC, opening_number DESC);
CREATE INDEX idx_openings_org_internal       ON openings (org_id, is_internal);
CREATE INDEX idx_openings_expiry_sweep       ON openings (status, first_published_at) WHERE status IN ('published','paused');
```

### sqlc Queries

`api-server/db/regional/queries/openings.sql`:

```sql
-- name: AllocateOpeningNumber :one
INSERT INTO org_opening_counters (org_id, next_opening_number)
VALUES (@org_id, 2)
ON CONFLICT (org_id) DO UPDATE
SET next_opening_number = org_opening_counters.next_opening_number + 1
RETURNING next_opening_number - 1 AS allocated_opening_number;

-- name: CreateOpening :one
INSERT INTO openings (
  org_id, opening_number, title, description, is_internal,
  employment_type, work_location_type,
  min_yoe, max_yoe, min_education_level,
  salary_min_amount, salary_max_amount, salary_currency,
  number_of_positions,
  hiring_manager_org_user_id, recruiter_org_user_id,
  cost_center_id, internal_notes, status
)
VALUES (
  @org_id, @opening_number, @title, @description, @is_internal,
  @employment_type, @work_location_type,
  sqlc.narg('min_yoe'), sqlc.narg('max_yoe'), sqlc.narg('min_education_level'),
  sqlc.narg('salary_min_amount'), sqlc.narg('salary_max_amount'), sqlc.narg('salary_currency'),
  @number_of_positions,
  @hiring_manager_org_user_id, @recruiter_org_user_id,
  sqlc.narg('cost_center_id'), sqlc.narg('internal_notes'),
  'draft'
)
RETURNING *;

-- name: GetOpeningByNumber :one
SELECT * FROM openings
WHERE org_id = @org_id AND opening_number = @opening_number;

-- name: GetOpeningByID :one
SELECT * FROM openings
WHERE opening_id = @opening_id AND org_id = @org_id;

-- name: ReplaceOpeningEditableFields :one
UPDATE openings
SET title                      = @title,
    description                = @description,
    employment_type            = @employment_type,
    work_location_type         = @work_location_type,
    min_yoe                    = sqlc.narg('min_yoe'),
    max_yoe                    = sqlc.narg('max_yoe'),
    min_education_level        = sqlc.narg('min_education_level'),
    salary_min_amount          = sqlc.narg('salary_min_amount'),
    salary_max_amount          = sqlc.narg('salary_max_amount'),
    salary_currency            = sqlc.narg('salary_currency'),
    number_of_positions        = @number_of_positions,
    hiring_manager_org_user_id = @hiring_manager_org_user_id,
    recruiter_org_user_id      = @recruiter_org_user_id,
    cost_center_id             = sqlc.narg('cost_center_id'),
    internal_notes             = sqlc.narg('internal_notes'),
    updated_at                 = NOW()
WHERE org_id = @org_id AND opening_number = @opening_number AND status = 'draft'
RETURNING *;

-- name: DiscardDraftOpening :exec
DELETE FROM openings
WHERE org_id = @org_id AND opening_number = @opening_number AND status = 'draft';

-- name: TransitionOpeningSubmit :one
UPDATE openings
SET status                = @target_status,
    first_published_at    = CASE WHEN @target_status = 'published' THEN NOW() ELSE first_published_at END,
    rejection_note        = NULL,
    updated_at            = NOW()
WHERE org_id = @org_id AND opening_number = @opening_number AND status = 'draft'
RETURNING *;

-- name: TransitionOpeningApprove :one
UPDATE openings
SET status              = 'published',
    first_published_at  = NOW(),
    updated_at          = NOW()
WHERE org_id = @org_id AND opening_number = @opening_number AND status = 'pending_review'
RETURNING *;

-- name: TransitionOpeningReject :one
UPDATE openings
SET status         = 'draft',
    rejection_note = @rejection_note,
    updated_at     = NOW()
WHERE org_id = @org_id AND opening_number = @opening_number AND status = 'pending_review'
RETURNING *;

-- name: TransitionOpeningPause :one
UPDATE openings SET status = 'paused', updated_at = NOW()
WHERE org_id = @org_id AND opening_number = @opening_number AND status = 'published'
RETURNING *;

-- name: TransitionOpeningReopen :one
UPDATE openings SET status = 'published', updated_at = NOW()
WHERE org_id = @org_id AND opening_number = @opening_number AND status = 'paused'
  AND first_published_at + INTERVAL '180 days' > NOW()
RETURNING *;

-- name: TransitionOpeningClose :one
UPDATE openings SET status = 'closed', updated_at = NOW()
WHERE org_id = @org_id AND opening_number = @opening_number AND status IN ('published','paused')
RETURNING *;

-- name: TransitionOpeningArchive :one
UPDATE openings SET status = 'archived', updated_at = NOW()
WHERE org_id = @org_id AND opening_number = @opening_number AND status IN ('closed','expired')
RETURNING *;

-- name: WorkerExpireOpenings :many
UPDATE openings
SET status     = 'expired',
    expired_at = NOW(),
    updated_at = NOW()
WHERE status IN ('published','paused')
  AND first_published_at + INTERVAL '180 days' <= NOW()
RETURNING *;

-- name: ListOpenings :many
SELECT o.*
FROM openings o
WHERE o.org_id = @org_id
  AND (sqlc.narg('filter_statuses')::opening_status[] IS NULL
       OR o.status = ANY(sqlc.narg('filter_statuses')::opening_status[]))
  AND (sqlc.narg('filter_is_internal')::boolean IS NULL OR o.is_internal = sqlc.narg('filter_is_internal')::boolean)
  AND (sqlc.narg('filter_hm')::uuid    IS NULL OR o.hiring_manager_org_user_id = sqlc.narg('filter_hm')::uuid)
  AND (sqlc.narg('filter_rec')::uuid   IS NULL OR o.recruiter_org_user_id      = sqlc.narg('filter_rec')::uuid)
  AND (sqlc.narg('filter_title_prefix')::text IS NULL OR o.title ILIKE sqlc.narg('filter_title_prefix')::text || '%')
  AND (sqlc.narg('filter_tags')::text[] IS NULL
       OR EXISTS (SELECT 1 FROM opening_tags ot
                  WHERE ot.opening_id = o.opening_id
                    AND ot.tag_id = ANY(sqlc.narg('filter_tags')::text[])))
  AND (@cursor_created_at::timestamptz IS NULL
       OR (o.created_at, o.opening_number) < (@cursor_created_at, @cursor_opening_number))
ORDER BY o.created_at DESC, o.opening_number DESC
LIMIT @limit_count;

-- name: GetOpeningAddresses :many
SELECT a.* FROM org_addresses a
JOIN opening_addresses oa ON oa.address_id = a.address_id
WHERE oa.opening_id = @opening_id;

-- name: GetOpeningHiringTeam :many
SELECT * FROM opening_hiring_team_members WHERE opening_id = @opening_id;

-- name: GetOpeningWatchers :many
SELECT * FROM opening_watchers WHERE opening_id = @opening_id;

-- name: GetOpeningTags :many
SELECT * FROM opening_tags WHERE opening_id = @opening_id;

-- name: ReplaceOpeningAddresses :exec
WITH del AS (DELETE FROM opening_addresses WHERE opening_id = @opening_id RETURNING 1)
INSERT INTO opening_addresses (opening_id, address_id)
SELECT @opening_id::uuid, UNNEST(@address_ids::uuid[]);

-- name: ReplaceOpeningHiringTeam :exec
WITH del AS (DELETE FROM opening_hiring_team_members WHERE opening_id = @opening_id RETURNING 1)
INSERT INTO opening_hiring_team_members (opening_id, org_user_id)
SELECT @opening_id::uuid, UNNEST(@org_user_ids::uuid[]);

-- name: ReplaceOpeningWatchers :exec
WITH del AS (DELETE FROM opening_watchers WHERE opening_id = @opening_id RETURNING 1)
INSERT INTO opening_watchers (opening_id, org_user_id)
SELECT @opening_id::uuid, UNNEST(@org_user_ids::uuid[]);

-- name: ReplaceOpeningTags :exec
WITH del AS (DELETE FROM opening_tags WHERE opening_id = @opening_id RETURNING 1)
INSERT INTO opening_tags (opening_id, tag_id)
SELECT @opening_id::uuid, UNNEST(@tag_ids::text[]);

-- name: ValidateOrgAddressesActive :many
SELECT address_id FROM org_addresses
WHERE org_id = @org_id
  AND status = 'active'
  AND address_id = ANY(@address_ids::uuid[]);

-- name: ValidateOrgUsersActive :many
SELECT org_user_id FROM org_users
WHERE org_id = @org_id
  AND status = 'active'
  AND org_user_id = ANY(@org_user_ids::uuid[]);

-- name: ValidateCostCenterActive :one
SELECT cost_center_id FROM cost_centers
WHERE org_id = @org_id AND cost_center_id = @cost_center_id AND status = 'enabled';
```

Notes for sqlc generation:

- `opening_status`, `employment_type`, `work_location_type`, `education_level` map to typed Go enum aliases; the package alias `org` from `specs/typespec/org/openings.go` is the canonical source.
- All write queries return `(opening, sql.ErrNoRows)` on illegal state; handlers map `ErrNoRows` to either 404 (no row) or 422 (wrong status) by checking via `GetOpeningByNumber` afterwards.

### Backend

#### Endpoint registration

Per CLAUDE.md `Handler Organization & Middleware`, in `api-server/internal/routes/org-routes.go`:

```go
orgRoleViewOpenings   := middleware.OrgRole(s.Regional, orgspec.OrgRoleViewOpenings, orgspec.OrgRoleManageOpenings)
orgRoleManageOpenings := middleware.OrgRole(s.Regional, orgspec.OrgRoleManageOpenings)

mux.Handle("POST /org/create-opening",    orgAuth(orgRoleManageOpenings(http.HandlerFunc(org.CreateOpening   (s)))))
mux.Handle("POST /org/list-openings",     orgAuth(orgRoleViewOpenings  (http.HandlerFunc(org.ListOpenings    (s)))))
mux.Handle("POST /org/get-opening",       orgAuth(orgRoleViewOpenings  (http.HandlerFunc(org.GetOpening      (s)))))
mux.Handle("POST /org/update-opening",    orgAuth(orgRoleManageOpenings(http.HandlerFunc(org.UpdateOpening   (s)))))
mux.Handle("POST /org/discard-opening",   orgAuth(orgRoleManageOpenings(http.HandlerFunc(org.DiscardOpening  (s)))))
mux.Handle("POST /org/duplicate-opening", orgAuth(orgRoleManageOpenings(http.HandlerFunc(org.DuplicateOpening(s)))))
mux.Handle("POST /org/submit-opening",    orgAuth(orgRoleManageOpenings(http.HandlerFunc(org.SubmitOpening   (s)))))
mux.Handle("POST /org/approve-opening",   orgAuth(orgRoleManageOpenings(http.HandlerFunc(org.ApproveOpening  (s)))))
mux.Handle("POST /org/reject-opening",    orgAuth(orgRoleManageOpenings(http.HandlerFunc(org.RejectOpening   (s)))))
mux.Handle("POST /org/pause-opening",     orgAuth(orgRoleManageOpenings(http.HandlerFunc(org.PauseOpening    (s)))))
mux.Handle("POST /org/reopen-opening",    orgAuth(orgRoleManageOpenings(http.HandlerFunc(org.ReopenOpening   (s)))))
mux.Handle("POST /org/close-opening",     orgAuth(orgRoleManageOpenings(http.HandlerFunc(org.CloseOpening    (s)))))
mux.Handle("POST /org/archive-opening",   orgAuth(orgRoleManageOpenings(http.HandlerFunc(org.ArchiveOpening  (s)))))
```

#### Handler step lists (`api-server/handlers/org/openings.go`)

All handlers begin with the standard pattern in CLAUDE.md (decode → validate → tx → respond) and use `s.WithRegionalTx`.

- **CreateOpening**:
  1. Decode + validate. On validation error → 400 with `[{field,message}]`.
  2. Single regional tx:
     a. `ValidateOrgAddressesActive(org_id, address_ids)` — return count must equal request length, else 422 with sentinel `INVALID_ADDRESS_IDS`.
     b. `ValidateOrgUsersActive(org_id, [hiring_manager, recruiter, ...team, ...watchers])` — must equal distinct count, else 422 with sentinel `INVALID_ORG_USER_IDS`. Also assert hiring_manager ≠ recruiter, hiring_manager ∉ team, recruiter ∉ team.
     c. If `cost_center_id` provided: `ValidateCostCenterActive(org_id, cost_center_id)`; not-found → 422.
     d. Tag IDs (if any) — global read against `tags` to assert each is active; mismatch → 422. (Per CLAUDE.md "one round-trip per logical DB", batch into a single `WHERE tag_id = ANY($1) AND status = 'active'`.)
     e. `AllocateOpeningNumber(org_id)` to atomically reserve the next number.
     f. `CreateOpening(...)` → opening row.
     g. `ReplaceOpeningAddresses`, `ReplaceOpeningHiringTeam`, `ReplaceOpeningWatchers`, `ReplaceOpeningTags` (each is a one-shot DELETE-then-INSERT-from-UNNEST).
     h. Audit row `org.create_opening` with `event_data = {opening_id, opening_number, title, is_internal}`.
  3. Return 201 `{ opening_id, opening_number }`.

- **ListOpenings**: read-only handler. Single tx not required; use `s.Regional.GetRegionalConn(ctx)` directly. Decode keyset cursor (base64 of `created_at|opening_number`). Default `limit=25`, max 100. Run `ListOpenings` with the filters; for the response payload, build `OpeningSummary[]` by joining hiring_manager + recruiter (one bulk `WHERE org_user_id = ANY($1)`); also fetch the first address per opening (one bulk query). Set `next_pagination_key` if returned `len == limit`.

- **GetOpening**: single regional read using `GetOpeningByNumber`; 404 if not found. Then in parallel: `GetOpeningAddresses` (for joining `org_addresses`), `GetOpeningHiringTeam` (then bulk-resolve OrgUserShort), `GetOpeningWatchers` (bulk-resolve), `GetOpeningTags` (bulk-resolve via global `tags`), and `cost_center` (if cost_center_id present). Compose `Opening` model. 200.

- **UpdateOpening**: validate body → single regional tx → call `ReplaceOpeningEditableFields`. If `RowsAffected == 0`, fall back: `GetOpeningByNumber` to differentiate 404 vs 422. Re-validate referenced UUIDs (addresses, org users, cost center, tags) inside the same tx. Replace all junction tables. Audit `org.update_opening`. Return 200 with the new full Opening.

- **DiscardOpening**: regional tx → `DiscardDraftOpening`; if no row affected, fall back to `GetOpeningByNumber` to differentiate 404 vs 422. Audit `org.discard_opening` BEFORE the DELETE inside the same tx (audit logs survive — they have no FK to openings). Return 204.

- **DuplicateOpening**: regional tx → `GetOpeningByNumber` (any state). 404 if not found. Allocate new opening_number; insert clone via `CreateOpening` (status='draft', `rejection_note=NULL`, `first_published_at=NULL`, `filled_positions=0`, `is_internal` copied). Replace junctions with the source's contents. Audit `org.duplicate_opening` with `{opening_id, opening_number, source_opening_id}`. Return 201.

- **SubmitOpening**: caller's roles include `org:superadmin`? — passed by the role middleware; the handler reads `caller.Roles` via context. In the regional tx: choose `target_status = 'published'` if superadmin else `'pending_review'`. Call `TransitionOpeningSubmit(target_status)`. If no row → 404 vs 422 split. Audit either `org.submit_opening` (non-superadmin) or `org.publish_opening` with `via='submit_superadmin'`. Return 200.

- **ApproveOpening**: regional tx → `TransitionOpeningApprove`. 404 vs 422. Audit `org.publish_opening` with `via='approve'`. Return 200.

- **RejectOpening**: validate request (`rejection_note` required, max 2000 chars). Regional tx → `TransitionOpeningReject(rejection_note)`. 404 vs 422. Audit `org.reject_opening` with `{rejection_note}`. Return 200.

- **PauseOpening / ReopenOpening / CloseOpening / ArchiveOpening**: each handler is identical in shape — single tx, single transition query, 404 vs 422 split, single audit row, return 200.

#### Cross-DB note

Openings + tags: `tag_id` is a global concept (per `org-tags` typespec). The handler does **one** global read per write to assert tag-id validity; the regional tx writes `opening_tags` rows with the (validated) `tag_id` text. This satisfies CLAUDE.md "Cross-DB Data: exactly one call to each".

#### Audit Log Events

Already enumerated in Stage 1 § "Audit Log Events". Audit writes go to the regional `audit_logs` table inside the same `s.WithRegionalTx`. The expire-worker writes with `actor_user_id = NULL`.

### Worker

`api-server/cmd/regional-worker/expire_openings.go`:

```go
package main

import (
  "context"
  "time"
  // ... usual imports
)

// Run every 6 hours.
func runExpireOpenings(ctx context.Context, s *server.RegionalServer) error {
  log := s.Logger(ctx)
  return s.WithRegionalTx(ctx, func(qtx *regdb.Queries) error {
    rows, err := qtx.WorkerExpireOpenings(ctx)
    if err != nil { return err }
    for _, row := range rows {
      err := qtx.AppendAuditLog(ctx, regdb.AppendAuditLogParams{
        EventType:    "org.expire_opening",
        ActorUserID:  pgtype.UUID{Valid: false},  // NULL
        EventData:    mustJSON(map[string]any{
          "opening_id":     row.OpeningID,
          "opening_number": row.OpeningNumber,
          "expired_at":     row.ExpiredAt,
        }),
      })
      if err != nil { return err }
    }
    log.Info("expired_openings_swept", "count", len(rows))
    return nil
  })
}
```

The regional-worker scheduler (existing) registers this every 6 hours; one process per region.

### Frontend

#### New Routes

| Portal | Route path                      | Page component                             |
| ------ | ------------------------------- | ------------------------------------------ |
| org-ui | `/openings`                     | `src/pages/Openings/OpeningsListPage.tsx`  |
| org-ui | `/openings/new`                 | `src/pages/Openings/CreateOpeningPage.tsx` |
| org-ui | `/openings/:openingNumber`      | `src/pages/Openings/OpeningDetailPage.tsx` |
| org-ui | `/openings/:openingNumber/edit` | `src/pages/Openings/EditOpeningPage.tsx`   |

#### Implementation notes

- Standard feature page layout: maxWidth 1200, back button first, Title level=2, no outer Card.
- `OpeningsListPage`:
  - Filter row (Segmented for status, Select for visibility, Pickers for hiring manager / recruiter, multi-select Tag picker, free-text title input).
  - Ant Design `Table` with the columns from Stage 1 Screen § Opening List. Cursor-based "Load more" pagination.
  - "Create Opening" primary button hidden if user lacks `org:manage_openings`.
  - Per-row Actions popover renders contextually as documented.
- `CreateOpeningPage`:
  - Uses Ant Design `Form` (controlled). Sections grouped via `Card`s: Basics (title, description, internal toggle), Employment (type, work location, addresses), Requirements (yoe, education), Compensation (salary trio), Team (hiring manager, recruiter, team, watchers), Cost Center, Tags, Internal Notes.
  - Wrap `<Spin>`. Disable submit while form has validation errors.
  - On success → navigate to `/openings/:openingNumber`.
- `OpeningDetailPage`:
  - Renders all fields read-only.
  - Sidebar with status badge, opening_number, composite identifier, dates, banners (per Stage 1).
  - Action buttons rendered contextually as in Stage 1; modal for Reject (rejection_note input).
  - Render `Rejection note` banner above Edit button when status=`draft` and `rejection_note` not null.
- `EditOpeningPage`:
  - Same form as Create, pre-populated; `Internal Opening` checkbox shown disabled.
  - 422 from API → display the inline error and route the user back to the detail page after a brief delay.
- Type imports:
  - `import type { CreateOpeningRequest, Opening, ListOpeningsRequest } from "vetchium-specs/org/openings";`
  - Validators imported from the same package.
- Date formatting: `formatDateTime(value, i18n.language)` for created_at; `formatDate(value, i18n.language)` for `first_published_at + 180d` banner math.

### RBAC

#### New roles

All four locations must be kept in sync:

- `specs/typespec/common/roles.ts` — append `org:view_openings` and `org:manage_openings` to `VALID_ROLE_NAMES`.
- `specs/typespec/common/roles.go` — append matching constants.
- `specs/typespec/org/org-users.ts` and `.go` — add `OrgRoleViewOpenings` and `OrgRoleManageOpenings` constants.
- `api-server/db/migrations/regional/00000000000001_initial_schema.sql` — INSERT into the `roles` seed:

```sql
('org:view_openings',   'Read-only access to job openings'),
('org:manage_openings', 'Full lifecycle on job openings (create, edit, submit, approve, reject, pause, reopen, close, archive, discard, duplicate)')
```

#### Existing roles reused

- `org:superadmin` — bypass; also routes submit-opening directly to PUBLISHED.

### i18n

Add `org-ui/src/locales/{en-US,de-DE,ta-IN}/openings.json`:

```json
{
	"title": "Job Openings",
	"backToDashboard": "Back to Dashboard",
	"createOpening": "Create Opening",
	"filter": {
		"status": "Status",
		"visibility": "Visibility",
		"visibilityAll": "All",
		"visibilityPublic": "Public",
		"visibilityInternal": "Internal",
		"hiringManager": "Hiring Manager",
		"recruiter": "Recruiter",
		"tags": "Tags",
		"titlePrefix": "Title contains"
	},
	"status": {
		"draft": "Draft",
		"pending_review": "Pending Review",
		"published": "Published",
		"paused": "Paused",
		"expired": "Expired",
		"closed": "Closed",
		"archived": "Archived"
	},
	"table": {
		"openingNumber": "#",
		"title": "Title",
		"visibility": "Visibility",
		"status": "Status",
		"hiringManager": "Hiring Manager",
		"recruiter": "Recruiter",
		"employmentType": "Employment Type",
		"workLocation": "Work Location",
		"positions": "Positions",
		"createdAt": "Created At",
		"actions": "Actions",
		"view": "View",
		"edit": "Edit",
		"submit": "Submit for Review",
		"approve": "Approve",
		"reject": "Reject",
		"pause": "Pause",
		"reopen": "Reopen",
		"close": "Close",
		"archive": "Archive",
		"discard": "Discard",
		"duplicate": "Duplicate"
	},
	"form": {
		"title": "Title",
		"description": "Description",
		"isInternal": "Internal opening (only visible to OrgUsers)",
		"employmentType": "Employment Type",
		"workLocationType": "Work Location Type",
		"addresses": "Addresses",
		"minYoe": "Minimum Experience (years)",
		"maxYoe": "Maximum Experience (years)",
		"minEducationLevel": "Minimum Education Level",
		"salaryMin": "Salary — Min",
		"salaryMax": "Salary — Max",
		"salaryCurrency": "Currency",
		"numberOfPositions": "Number of Positions",
		"hiringManager": "Hiring Manager",
		"recruiter": "Recruiter",
		"hiringTeamMembers": "Hiring Team Members",
		"watchers": "Watchers",
		"costCenter": "Cost Center",
		"tags": "Tags / Skills",
		"internalNotes": "Internal Notes",
		"saveAsDraft": "Save as Draft",
		"saveChanges": "Save Changes"
	},
	"detail": {
		"rejectionBanner": "Returned for changes by {{approver}}: {{note}}",
		"publishedBanner": "This opening will be automatically expired on {{expiresOn}}.",
		"pausedBanner": "This opening is paused and hidden from the Hub. The 180-day expiry clock is still running and will fire on {{expiresOn}}.",
		"expiredBanner": "This opening expired automatically on {{expiredOn}} and no longer accepts new applications."
	},
	"rejectModal": {
		"title": "Reject this opening?",
		"noteLabel": "Reason (visible to the author when the opening returns to draft)",
		"submit": "Reject"
	},
	"discardConfirm": "Discard this draft opening? This cannot be undone.",
	"success": {
		"created": "Opening saved as draft",
		"updated": "Opening updated",
		"discarded": "Draft discarded",
		"duplicated": "Opening duplicated",
		"submitted": "Submitted for review",
		"published": "Published",
		"approved": "Approved",
		"rejected": "Returned to draft",
		"paused": "Paused",
		"reopened": "Reopened",
		"closed": "Closed",
		"archived": "Archived"
	},
	"errors": {
		"loadFailed": "Failed to load openings",
		"saveFailed": "Failed to save opening",
		"transitionFailed": "Could not change opening status",
		"invalidAddresses": "One or more selected addresses are not active",
		"invalidOrgUsers": "One or more selected OrgUsers are not active",
		"invalidCostCenter": "Selected cost center is not active",
		"invalidTags": "One or more selected tags are not active",
		"notEditable": "This opening is no longer editable. Close it and create a new one to make changes."
	}
}
```

Mirror with placeholder English values in `de-DE/openings.json` and `ta-IN/openings.json`.

### Test Matrix

Tests in `playwright/tests/api/org/openings.spec.ts`. Types imported from `vetchium-specs/org/openings`.

Helpers to add to `playwright/lib/db.ts`:

- `createTestOpeningDirect(orgId, overrides?)` — bypasses API.
- `setOpeningStatusDirect(openingId, status)` — for state-machine tests.
- `setOpeningFirstPublishedAtDirect(openingId, dt)` — for worker tests (rewinds the clock).
- `getAuditLogCountForOrg(orgId, eventType?)` — for audit-log assertions.

Helpers to add to `playwright/lib/org-api-client.ts`: one typed + one Raw method per endpoint (13 endpoints × 2).

Per CLAUDE.md, every endpoint MUST have these tests:

- success, missing required, invalid value, unauthenticated (401), wrong role (403), correct role (positive 201/200/204), not found (404), invalid state (422 — when applicable), audit row written on success, no audit row on failure.

Endpoint-specific scenarios:

| Endpoint          | Specific scenarios                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| create-opening    | All required only · all + optional · references unknown address (422 INVALID_ADDRESS_IDS) · unknown OrgUser (422) · hiring manager == recruiter (422) · cost center disabled (422) · unknown tag (422) · 50-position cap (422) · is_internal true; tag_ids[] empty array; duplicate address_ids in request; salary partial trio (400) |
| list-openings     | Default · filter_status array · filter_is_internal · filter_hm · filter_rec · filter_tag_ids · filter_title_prefix · pagination · empty list                                                                                                                                                                                          |
| get-opening       | Existing draft · published · pending_review with rejection_note · archived · cross-org (404 — opening belongs to other org)                                                                                                                                                                                                           |
| update-opening    | Success on draft · 422 on pending_review/published/paused/closed/expired/archived · invalid address (422) · removed referenced cost center mid-flight (422)                                                                                                                                                                           |
| discard-opening   | Success on draft · 422 on any non-draft · audit row written before delete · GET-after returns 404                                                                                                                                                                                                                                     |
| duplicate-opening | From archived → new draft created with copied fields · is_internal copied · rejection_note cleared · first_published_at null on clone                                                                                                                                                                                                 |
| submit-opening    | Non-superadmin draft → pending_review · superadmin draft → published (with first_published_at set) · 422 from non-draft                                                                                                                                                                                                               |
| approve-opening   | pending_review → published · 422 from any other state · first_published_at set                                                                                                                                                                                                                                                        |
| reject-opening    | pending_review → draft with note · 400 if note empty · 400 if note > 2000                                                                                                                                                                                                                                                             |
| pause-opening     | published → paused · 422 from any other                                                                                                                                                                                                                                                                                               |
| reopen-opening    | paused → published when clock not elapsed · 422 when clock elapsed (force first_published_at to 181d ago via test helper)                                                                                                                                                                                                             |
| close-opening     | published → closed · paused → closed · 422 from any other                                                                                                                                                                                                                                                                             |
| archive-opening   | closed → archived · expired → archived · 422 from any other                                                                                                                                                                                                                                                                           |
| Worker `expire`   | Boundary: opening with first_published_at = 180d-1s ago is untouched · = 180d ago is expired · 181d ago is expired · paused with 180d ago is also expired · audit row written with actor_user_id = NULL                                                                                                                               |

#### RBAC test pairs

For every write endpoint, two tests:

1. Authenticated user with `org:manage_openings` and no superadmin → expected success.
2. Authenticated user with no roles → 403.

For every read endpoint:

1. Authenticated user with `org:view_openings` → expected success.
2. Authenticated user with no roles → 403.

For superadmin: assert it bypasses the role check on every endpoint via at least one happy-path test per write endpoint.

#### Cross-org isolation

A creates an opening in org-A; B is an OrgUser in org-B. Assert: B cannot list, get, update, transition, or discard the opening (404 / 403 / cross-org responses, depending on endpoint). All status codes match what an unrelated request would receive.

### Out-of-spec dependencies (forward links)

- `hub-employer-ids` is now a drafted spec at `specs/hub-employer-ids/README.md` — referenced by future endorsement design but **not** required for openings.
- `hub-job-discovery` (future): hub-side list/get of public openings. Excludes `is_internal = true`.
- `hub-job-applications` (future): hub-side apply flow with optional endorsement requests. Endorsements are gated by `hub-connections` `connected` state plus a verified shared-employer-with-tenure-overlap proof from `hub-employer-ids`. The endorsement state machine, employer-side visibility, and any reciprocal trust-graph signals are owned by that spec, not this one.

This Stage 2 ships TypeSpec, regional schema, sqlc queries, handler step lists, route registration, the worker, frontend route map, i18n, and a complete test matrix. A Haiku-tier implementer can follow the steps in order without spec re-interpretation.
