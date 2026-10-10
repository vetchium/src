# T02 Openings schema and permissions

Requirements: OPN-GEN-002, OPN-GEN-004, OPN-AUTH-001, OPN-AUTH-004,
OPN-LIFE-003, OPN-WC-001, OPN-WC-005, OPN-QTA-001, the Lifecycle table.

Guides: `database.md`, `backend/internal/db/AGENTS.md`, `authorization.md`,
`org-subscriptions.md` (delegation), `typespec.md`, `go.md`,
`typescript.md`, `ui.md`, `playwright.md`.

Exemplars: `vetchium.orgs`, `org_user_invitations`, and the permission
catalog in `db/migrations/00001_init.sql`; `typespec/orgs/authorization/`;
`backend/internal/orgs/users/delegation.go`;
`orgs-ui/src/features/users/PermissionTable.tsx` and the permission strings
in `orgs-ui/src/i18n/locales/*.ts`; `playwright/api/orgs-*.spec.ts` for
permission grants; `playwright/lib/orgs-api.ts` `cleanupOrg`.

## Schema

Edit `db/migrations/00001_init.sql` in place (no `ALTER` migrations before
production), above the audit-trigger loop, and drop everything in the down
section. Use the existing distinct-array helper and naming style.

- `vetchium.orgs`: add `next_opening_number integer NOT NULL DEFAULT 1`,
  `CHECK (next_opening_number >= 1)`.
- Enums: `org_opening_state` (`draft`, `discarded`, `published`, `paused`,
  `closed`, `expired`); `org_opening_work_arrangement`;
  `org_opening_remote_eligibility` (`worldwide`, `countries`);
  `org_opening_employment_type`; `org_opening_education`;
  `org_opening_salary_period`; `org_opening_content_slot` (`live`,
  `working`); `org_opening_request_kind` (`publish`, `revise`, `pause`,
  `reopen`, `close`); `org_opening_request_state` (`pending`, `approved`,
  `rejected`, `withdrawn`, `superseded`, `cancelled`);
  `org_opening_history_action` (`created`, `duplicated`, `team_changed`,
  `revision_discarded`, `discarded`, `requested`, `approved`,
  `self_approved`, `rejected`, `withdrawn`, `superseded`, `cancelled`,
  `expired`).
- `org_openings`: `org_opening_id uuid PK` (UUIDv7 from Go, never on the
  wire), `org_did` FK `ON DELETE CASCADE`, `opening_number integer >= 1`,
  `opening_state` default `draft`, `version integer NOT NULL DEFAULT 1`,
  `revision integer NOT NULL DEFAULT 0`, `hiring_manager_id` and
  `recruiter_id` nullable FKs to `org_users`, `internal_notes` (trimmed,
  1–2,000 code points or NULL), `created_by` FK, `created_at`, `updated_at`,
  `first_published_at`, `expires_at`, `last_revised_at`, `ended_at`.
  Constraints: `UNIQUE (org_did, opening_number)`;
  `(first_published_at IS NULL) = (opening_state IN ('draft','discarded'))`;
  `expires_at` NULL exactly when `first_published_at` is, else
  `first_published_at + interval '180 days'`; `ended_at` set exactly in
  `discarded`, `closed`, `expired`; `discarded` holds no hiring manager,
  recruiter, or notes; `(last_revised_at IS NULL) = (revision = 0)`;
  `updated_at >= created_at`. Indexes: `(org_did, created_at)` for the
  quota; `(expires_at) WHERE opening_state IN ('published','paused')`;
  `(org_did, updated_at DESC, opening_number DESC)` for lists; and
  `hiring_manager_id`, `recruiter_id`.
- `org_opening_contents`: PK `(org_opening_id, slot)`, FK cascade; one
  nullable column per content field (`remote_countries text[]`,
  `experience_min`, `experience_max`, `salary_currency`, `salary_min
  bigint`, `salary_max bigint`, `salary_period`); `updated_by`, `updated_at`.
  CHECKs mirror every T01 rule (code-point lengths with `char_length`, codes
  by pattern, salary all-or-none, remote rules). A stored generated column
  `complete` mirrors `MissingForPublication`, and
  `CHECK (slot <> 'live' OR complete)`. Comment that the Go validator and
  these constraints change together.
- `org_opening_team_members`: PK `(org_opening_id, org_user_id)`, FKs,
  index on `org_user_id`.
- `org_opening_requests`: `org_opening_request_id uuid PK`, opening FK
  cascade, `request_kind`, `request_state` default `pending`,
  `requested_by`, `requested_at`, `request_note` (1–2,000 or NULL),
  `decided_by`, `decided_at`, `decision_note` (1–2,000 or NULL),
  `self_approved boolean NOT NULL DEFAULT false`. Constraints: pending
  exactly when `decided_at IS NULL`; `rejected` needs `decision_note`;
  `decided_by` set for `approved`, `rejected`, `withdrawn`;
  `self_approved` only when `approved`. Partial unique index on
  `(org_opening_id) WHERE request_state = 'pending'` (OPN-LIFE-003).
- `org_opening_history`: `org_opening_history_id uuid PK`, opening FK
  cascade, `action`, `actor_org_user_id` (NULL for the system),
  `org_opening_request_id` (nullable FK), `source_opening_number` (for
  `duplicated`), `created_at`; index `(org_opening_id, created_at DESC,
  org_opening_history_id DESC)`.
- Permission catalog rows `org:view_openings`, `org:manage_openings`,
  `org:approve_openings`; implications `org:superadmin` → each of the three,
  `org:manage_openings` → `org:view_openings`, `org:approve_openings` →
  `org:view_openings` (one hop each).

## Steps

1. Write the schema above. Run `make migration-check`, `make sqlc`,
   `make sql-check`.
2. Add the three permissions to `typespec/orgs/authorization/types.*`
   (enum, `x-vetchium-known-values`, `x-vetchium-permission-implications`,
   Go and TS constants and implication tables) and their tests.
3. Delegation: add `org:approve_openings` to the reserved list in
   `backend/internal/orgs/users/delegation.go` (OPN-AUTH-004) with unit
   tests: a `org:manage_users` holder may grant view and manage, not approve.
4. orgs-ui: name and describe the three permissions in every locale so the
   permission screens present them (presets come in T08).
5. Make sure `cleanupOrg` removes every new row (cascade from `orgs` or
   explicit deletes) in every tenant.
6. Playwright API tests in the existing Org user-permission spec: grant and
   revoke each new permission as superadmin; as a `org:manage_users` holder
   (view and manage succeed, approve is `org-superadmin-required`); effective
   permissions report the implications.

## Checks

`make migration-check`, `make sqlc`, `make sql-check`, `make typespec-check`,
`make test-go`, `make test-go-static`, `make orgs-ui-check`,
`make playwright-check`, then `make test`.

## Acceptance

- Every new table has the audit trigger (the loop covers it) and appears in
  the down section.
- No handler for Openings yet; nothing references the tables from Go except
  generated sqlc.
