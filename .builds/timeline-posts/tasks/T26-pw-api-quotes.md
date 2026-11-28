# T26 Playwright: Test Hub quote APIs

## Requirements

PST-QTE-001 to PST-QTE-012, PST-POS-003, PST-BLK-002, PST-BLK-005, PST-RD-003

## Guides

`agent-guides/playwright.md`, `playwright/AGENTS.md`, `agent-guides/posts.md`

## Exemplars

- `playwright/api/hub-posts.spec.ts` (T13), `playwright/api/hub-post-replies.spec.ts` (T20)
- `playwright/api/hub-org-openings.spec.ts` (published Openings)

## Steps

1. Create `playwright/api/hub-post-quotes.spec.ts`.
2. Cover same-region and cross-region: quote a timeline post `201` on the
   free tier; quote counts toward the 100 cap; `nobody` policy and owner
   block `hub-post-quote-refused`; removed target `hub-post-not-found`;
   quote an Opening; unpublished Opening `hub-opening-not-found`; body
   required and limits; the target's quote count rises after the event
   (poll); quote list order, keyset, limit bounds, muted quoter filtered,
   `partial` false; detach reduces the count and the embed becomes
   `unavailable`; detach twice is `204` with one count change; removal of the
   quote reduces the count; removal after detach keeps the count; embeds on
   `list` and `get`; a quote of a quote embeds one level; an Opening embed
   becomes `unavailable` after the Opening closes.
3. Mesh: viewer verification failure for `read-quote-target`.

## Tests

`playwright/api/hub-post-quotes.spec.ts`.

## Checks

- `make playwright-check`
- `make test-environment`, then
  `npx playwright test api/hub-post-quotes.spec.ts --workers=2`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Every non-`5xx` response of each T23 operation maps to a named test.

## Carried over

From T25: `read-quote-target`, `read-embeds` items, and `list-quotes` now carry `owner_hub_user_did` (the relay needs it to route). An embed reads the quote row in the target owner's tenant, so a new quote shows `unavailable` until `hub-post-quoted` is delivered; the `create-quote` response carries the embed directly. Mesh `read-embeds` makes only the items of a failed region `unavailable`. `list-quotes` reads each quoter tenant once and sets `partial` when one fails.
