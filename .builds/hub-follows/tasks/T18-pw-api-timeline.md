# T18 Playwright: Test the Hub Timeline API

## Requirements

PST-TL-001 to PST-TL-007, PST-FOL-005, PST-FOL-006

## Guides

`agent-guides/playwright.md`, `playwright/AGENTS.md`, `agent-guides/posts.md`

## Exemplars

- `playwright/api/hub-post-quotes.spec.ts` (cross-region reads, a region
  that does not answer)
- `playwright/lib/hub-follows.ts` (T11)

## Steps

1. Add `timeline` to `playwright/lib/hub-posts.ts` (`HubPostsAPI.timeline`).
2. New `playwright/api/hub-timeline.spec.ts`, scenarios "same region" and
   "cross region":
   - A new user's Timeline holds only their own posts and quotes, newest
     first.
   - Following B adds B's latest posts (backfill); B's next post appears
     after the workers run (poll `timeline/list` until it appears, with
     the timeout other worker-driven tests use).
   - Unfollow removes B's posts; block (either direction) removes them;
     mute removes them.
   - A removed post leaves the Timeline.
   - B's region does not answer: B's posts are left out and the response
     has no error; when the region returns they reappear.
   - Pagination with limit 2 over 5 posts; `following_count`.

## Tests

The steps above.

## Checks

- `make playwright-check`
- `make test-environment`, then `npx playwright test
  api/hub-timeline.spec.ts` in `playwright/`
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- Contract coverage lists `/api/hub/timeline/list`.

## Carried over
