# T28 Playwright: Test the Hub quote screens

## Requirements

T27 behaviors, PST-UI-003

## Guides

`agent-guides/playwright.md`, `playwright/AGENTS.md`, `agent-guides/posts.md`

## Exemplars

- `playwright/ui/hub-posts.spec.ts` (T15), `playwright/ui/hub-org-page.spec.ts`

## Steps

1. Create `playwright/ui/hub-post-quotes.spec.ts`.
2. Cover: quote a post from its card and see the embed; quote an Opening from
   its page; cancel the dialog; refusal messages; no Quote button for
   `nobody`; nested quote shows a link; unavailable embed text; quotes page
   with Load more; partial notice (stub `/api/hub/posts/list-quotes` with
   `partial: true` through `page.route`, as `playwright/lib/hub-ui-stubs.ts`
   stubs other Hub calls); Detach with confirm and cancel by the owner, none for others.

## Tests

`playwright/ui/hub-post-quotes.spec.ts`.

## Checks

- `make playwright-check`
- `make test-environment`, then
  `npx playwright test ui/hub-post-quotes.spec.ts --workers=2`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Every T27 behavior maps to a named test.

## Carried over
