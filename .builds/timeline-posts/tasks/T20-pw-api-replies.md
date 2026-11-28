# T20 Playwright: Test Hub reply APIs

## Requirements

PST-RPL-001 to PST-RPL-014, PST-THR-001 to PST-THR-005, PST-THR-008,
PST-TAB-001 to PST-TAB-003, PST-BLK-002, PST-BLK-003, PST-BLK-005, PST-RD-003

## Guides

`agent-guides/playwright.md`, `playwright/AGENTS.md`, `agent-guides/posts.md`

## Exemplars

- `playwright/api/hub-chat-requests.spec.ts` (idempotency, `202`, operation
  status, cross-region)
- `playwright/api/hub-posts.spec.ts` (T13), `playwright/api/hub-blocks.spec.ts`
- `playwright/lib/psql-sessions.ts`

## Steps

1. Create `playwright/api/hub-post-replies.spec.ts`.
2. Same-region and cross-region (post owner in one region, replier in
   another) for: reply `200`; replay with the same key returns the same
   reply; same key, other body → idempotency conflict; sub-reply; reply to a
   sub-reply `validation-failed`; locked post and `nobody` policy
   `hub-post-replies-closed`; post owner blocked the replier
   `hub-post-reply-refused`; parent author blocked the replier on a third
   user's post `hub-post-reply-refused`; removed post `hub-post-not-found`;
   missing parent `hub-reply-not-found`; 500 cap `429`; body limits.
3. Thread reads: order, keyset, limit bounds, child pages; hidden reply
   absent for others and `hidden` for its author; hidden or removed reply
   with children is a `placeholder`; without children it is absent; muted
   author filtered out; counts after hide, unhide, remove.
4. Edit and remove: the copy in the thread changes (poll until the event
   arrives); window, revision, and ownership refusals; removal clears the
   words in both tenants (read the database).
5. Post removal: the job marks the reply `post_removed`; the Replies tab shows
   it with that state; structure rows are gone.
6. Replies tab: order, keyset, muted owner `muted: true`, remote owner.
7. Mesh: viewer verification failure for `list-replies`.
8. Pending path: make the post owner's region unreachable if the CI stack
   allows it (search `playwright/` for an existing pattern first); else record
   the `202` variant in `PLAYWRIGHT_UNTESTABLE_VARIANTS` with a reason.

## Tests

`playwright/api/hub-post-replies.spec.ts`.

## Checks

- `make playwright-check`
- `make test-environment`, then
  `npx playwright test api/hub-post-replies.spec.ts --workers=2`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Every non-`5xx` response of each T16 operation maps to a named test.

## Carried over

From T19: `hide-reply` and `unhide-reply` declare only `hub-reply-not-found`, so a post that is not the caller's or not live returns `hub-reply-not-found` (not `hub-post-not-found`). An edit result carries `child_count` 0: the author's tenant keeps no sub-reply counts.
