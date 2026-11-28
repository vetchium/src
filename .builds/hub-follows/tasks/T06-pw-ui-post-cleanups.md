# T06 Playwright: Test the Allow replies, tag, and quote screens

## Requirements

PST-UI-005, PST-UI-006, PST-UI-009, PST-UI-010, PST-TAG-005

## Guides

`agent-guides/playwright.md`, `playwright/AGENTS.md`, `agent-guides/ux.md`,
`agent-guides/posts.md`

## Exemplars

- `playwright/ui/hub-posts.spec.ts`, `hub-post-quotes.spec.ts`,
  `hub-post-replies.spec.ts`, `hub-post-journeys.spec.ts`

## Steps

1. `playwright/ui/hub-posts.spec.ts`: compose with 2 tags and "Allow
   replies" off from Sidebar "Timeline"; the post page shows both tags and
   the switch off; turning it on saves at once and shows the message; the
   tag picker refuses a fourth tag; edit inside the window changes a tag.
2. `playwright/ui/hub-post-replies.spec.ts`: with replies off another user
   sees "The author turned off replies" and no composer; the owner still
   sees the composer and replies.
3. `playwright/ui/hub-post-quotes.spec.ts`: no Quote button on the own
   post; a Quote button on another user's post; "0 quotes" is not a link;
   no Detach on the quotes page.
4. `playwright/ui/hub-post-journeys.spec.ts`: the journey from Home through
   Sidebar "Timeline" to a post's "Allow replies" switch.

## Tests

The steps above.

## Checks

- `make playwright-check`
- `make test-environment`, then `npx playwright test ui/hub-posts.spec.ts
  ui/hub-post-replies.spec.ts ui/hub-post-quotes.spec.ts
  ui/hub-post-journeys.spec.ts` in `playwright/`
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- Each UI rule above has a passing test.

## Carried over
