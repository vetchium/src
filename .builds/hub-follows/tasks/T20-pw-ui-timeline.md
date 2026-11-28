# T20 Playwright: Test the Timeline screens

## Requirements

PST-UI-004, PST-UI-008, PST-UI-016, PST-TL-001

## Guides

`agent-guides/playwright.md`, `playwright/AGENTS.md`, `agent-guides/ux.md`,
`agent-guides/posts.md`

## Exemplars

- `playwright/ui/hub-posts.spec.ts`, `playwright/ui/hub-post-journeys.spec.ts`

## Steps

1. New `playwright/ui/hub-timeline.spec.ts`:
   - Empty state for a new Silver user, with the composer.
   - Below Silver: the upgrade prompt in place of the composer.
   - A followed user's post shows in the feed after the workers run; the
     time link opens the post page.
   - Load more with more than 20 entries.
   - Posting from the composer shows the post at the top.
2. Update `playwright/ui/hub-posts.spec.ts` and
   `playwright/ui/hub-post-journeys.spec.ts` where they assumed Timeline
   showed only the own posts.

## Tests

The steps above.

## Checks

- `make playwright-check`
- `make test-environment`, then `npx playwright test ui/hub-timeline.spec.ts
  ui/hub-posts.spec.ts ui/hub-post-journeys.spec.ts` in `playwright/`
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- Each Timeline UI rule has a passing test.

## Carried over
