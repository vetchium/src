# T13 Playwright: Test Hub timeline post APIs

## Requirements

PST-GEN-002, PST-GEN-003, PST-GEN-004, PST-POS-001 to PST-POS-011,
PST-BLK-005, PST-THR-007, PST-RD-003

## Guides

`agent-guides/playwright.md`, `playwright/AGENTS.md`, `agent-guides/posts.md`

## Exemplars

- `playwright/api/hub-profile-read-alias.spec.ts`,
  `playwright/api/hub-subscriptions.spec.ts` (plan changes),
  `playwright/api/hub-audit.spec.ts`, `playwright/api/mesh.spec.ts`
- `playwright/lib/hub-api.ts`, `playwright/lib/psql-sessions.ts` (move
  `created_at` back for the window and the cap)

## Steps

1. Create `playwright/api/hub-posts.spec.ts` and
   `playwright/api/hub-profile-cards.spec.ts`.
2. Posts: create `201` on Silver; free tier `hub-plan-required`; body 0, 513
   code points, and U+0000 refused; 512 multi-byte accepted; trim kept;
   cap: insert 100 rows (database helper) then `429`; edit success with
   `edited: true` and `revision: 2`; stale revision `hub-post-conflict`;
   window closed (move `created_at` 31 minutes back) `hub-post-edit-closed`;
   another user's post `hub-post-not-found`; downgrade to free then edit
   `hub-plan-required`, while remove and set-policies still work; remove then
   get `hub-post-not-found`; list order and keyset; list a muted owner gives
   `muted: true` and no posts; cross-region list and get; invalid
   pagination key; audit events exist and hold no words.
3. Cards: local and remote handles; an unknown handle in `unavailable`; 0
   and 51 handles refused; duplicates refused.
4. Mesh: viewer verification failure for `/api/mesh/posts/list` and
   `/api/mesh/profile/read-cards`.

## Tests

The two spec files above.

## Checks

- `make playwright-check`
- `make test-environment`, then
  `npx playwright test api/hub-posts.spec.ts api/hub-profile-cards.spec.ts --workers=2`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Every non-`5xx` response of each T10 operation maps to a named test.

## Carried over

From T12 (orchestrator): T12 made post pagination keys unsigned base64 cursors. The nearest Hub code signs keys and binds them to the list (`backend/handlers/hub/messages/requests.go` `signRequests` and `verifyRequests`, `credentials.SignValue` with the `pagination` subkey). First change the T12 post list keys (`/api/hub/posts/list` and the mesh list) to the same signed shape, bound to the owner DID. A tampered or foreign key returns `invalid-pagination-key`. Then test it in `hub-posts.spec.ts`. Use the same signed shape for every later list key, including the fan-out cursor from T03 when a portal operation returns it.
