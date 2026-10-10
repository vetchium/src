# T08 Orgs portal requests, approvals, and presets

Requirements: OPN-LIFE-001 to OPN-LIFE-009, OPN-ORG-001 (request filters),
OPN-ORG-003, OPN-ORG-005, OPN-ORG-006, OPN-AUTH-005.

Guides: as T07.

Exemplars: the T07 feature; `orgs-ui/src/features/users/roles.ts` and
`PermissionTable.tsx` (presets); `playwright/ui/orgs-users.spec.ts`.

## Steps

1. Actions on the detail page, by state and effective permission: request
   (or, for approvers, directly do) publish, revise, pause, reopen, close,
   each with an optional note; approve and reject (note required) for
   approvers; withdraw for managers. Label actions by effect: "Submit for
   approval" without `org:approve_openings`, "Publish" with it
   (OPN-ORG-005). Confirm close and pause with their consequences.
2. Show a pending request prominently with requester, time, note, and a
   side-by-side of working copy and live content for `revise`.
3. List: an "Awaiting my approval" view for approvers and the pending
   request kind filter; a count in the summary strip.
4. Presets Recruiter (`org:manage_openings`) and Hiring approver
   (`org:approve_openings`) in `roles.ts`, labelled in every locale; Custom
   labelling still works. Only superadmins can tick approve (the API
   refuses others; the UI explains it).
5. Every string in every orgs-ui locale.
6. Playwright UI tests: manager submits and an approver approves; reject
   with note and resubmit; withdraw; approver self-publish; revise flow
   with side-by-side; pause, reopen, and close with approval and the
   approver's direct close superseding a pending request; version conflict
   message; presets in the member drawer.

## Checks

As T07, then `make test`.
