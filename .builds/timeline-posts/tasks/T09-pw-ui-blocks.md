# T09 Playwright: Test the Hub block and mute screens

## Requirements

PST-BLK-006, PST-BLK-007, PST-BLK-008, T08 screens

## Guides

`agent-guides/playwright.md`, `playwright/AGENTS.md`, `agent-guides/posts.md`

## Exemplars

- `playwright/ui/hub-profile-view.spec.ts`
- `playwright/ui/hub-profile-editor.spec.ts`
- `playwright/lib/region-ui.ts`

## Steps

1. Create `playwright/ui/hub-blocks.spec.ts`.
2. Cover: Block from the profile menu with confirm and cancel; the menu then
   shows Unblock; Mute and Unmute; the menu is absent on one's own profile;
   `/settings/blocks` lists both kinds with Load more (seed 21 rows through
   the API); Unblock and Unmute from the page; empty states; a server error
   on Unblock shows the error and keeps the row; the route needs a session
   (redirect to login).
3. Run at least one case with a user in another region.

## Tests

`playwright/ui/hub-blocks.spec.ts` (this task).

## Checks

- `make playwright-check`
- `make test-environment`, then `npx playwright test ui/hub-blocks.spec.ts --workers=2`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Every T08 behavior maps to a named test.

## Carried over
