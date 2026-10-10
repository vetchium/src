# T04 Orgs API for requests and approvals

Requirements: OPN-LIFE-001 to OPN-LIFE-008, OPN-LIFE-010, OPN-WC-002,
OPN-WC-003, OPN-TEAM-004, OPN-AUTH-006, OPN-QTA-003, OPN-ORG-001 (request
filters), the Lifecycle table.

Guides: as T03.

Exemplars: the T03 handlers, queries, contract, and spec file;
`backend/internal/db/queries/org_users.sql` (state-guarded statements with
audit CTEs).

## Contract

Add to `typespec/orgs/openings/`, every write with `Idempotency-Key`:

- `request-opening-change` → `OrgOpening`: `opening_number`, `version`,
  `kind` (`publish`, `revise`, `pause`, `reopen`, `close`), `note?`
  (1–2,000). Needs `org:manage_openings`.
- `decide-opening-request` → `OrgOpening`: `opening_number`, `version`,
  `decision` (`approve`, `reject`), `note?` (required to reject). Needs
  `org:approve_openings`.
- `withdraw-opening-request` → `OrgOpening`: `opening_number`, `version`.
  Needs `org:manage_openings` (OPN-LIFE-006).
- `list-openings` gains `pending_request_kinds` and `awaiting_my_approval`
  (pending requests the caller may decide: caller holds
  `org:approve_openings`).
- Problem `org-opening-incomplete` 422 listing field paths (from
  `MissingForPublication`, plus `hiring_manager_email` and
  `recruiter_email` when unset).

## Behavior

- Valid kinds by state: `publish` from `draft`; `revise` from `published`
  or `paused` with a working copy; `pause` from `published`; `reopen` from
  `paused`; `close` from `published` or `paused`. Otherwise
  `org-opening-state-conflict`.
- `publish` and `revise` check completeness and an active hiring manager and
  recruiter when requested and again when approved (OPN-CNT-002,
  OPN-TEAM-004).
- A caller holding `org:approve_openings` applies the request at once in the
  same statement: insert it as `approved` with `self_approved`, apply the
  transition, write `self_approved` history and audit (OPN-LIFE-002).
- Otherwise insert it `pending`; the partial unique index enforces one
  pending request. A second request is `org-opening-request-pending`,
  except an approver's `close`, which marks the pending one `superseded`
  and closes at once (OPN-LIFE-003).
- Applying: `publish` turns the working row into the `live` row, sets
  `first_published_at = now()` and `expires_at`; `revise` copies the working
  values onto the live row, deletes the working row, increments `revision`,
  sets `last_revised_at` (never write one key from two sibling CTEs);
  `pause`, `reopen`, `close` change state; `close` sets `ended_at` and
  deletes any working copy. Quota is never checked (OPN-QTA-003).
- Reject keeps the working copy editable (OPN-LIFE-007). Withdraw likewise.
- Every decision is one statement guarded by state, `version`, and the
  pending request; it re-checks the decider's permission in SQL.
- History: `requested`, `approved`, `self_approved`, `rejected`,
  `withdrawn`, `superseded`, linked to the request. Audit every one.
- `get-opening` and `list-openings` show the pending request.

## Tests

Extend the Openings API specs: every kind through approve, reject, withdraw,
and the self-approved path (OPN-LIFE-002 requires both paths for every
kind); approver close superseding a pending request; a requester granted
approval later approving their own pending request; incomplete content and
a disabled hiring manager at request and at approval; a revoked approver
(the request stays pending); version conflicts between an edit and an
approval; concurrent decisions (one wins); invalid kind for the state;
`awaiting_my_approval`; history entries; audit without content.

## Checks

As T03, then `make test`.
