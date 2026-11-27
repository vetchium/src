# T15 Playwright: Test the Hub timeline post screens

## Requirements

T14 behaviors, PST-UI-001, PST-UI-002, PST-UI-004, PST-UI-005, PST-BLK-005

## Guides

`agent-guides/playwright.md`, `playwright/AGENTS.md`, `agent-guides/posts.md`

## Exemplars

- `playwright/ui/hub-profile-view.spec.ts`, `playwright/ui/hub-plans.spec.ts`
- `playwright/ui/hub-blocks.spec.ts` (T09)

## Steps

1. Create `playwright/ui/hub-posts.spec.ts`.
2. Cover: compose and see the post on the Posts tab; counter at 512 and
   refusal at 513; limit-reached message; free-tier owner sees the upgrade
   prompt; another user sees no composer; edit inside the window, no Edit
   button after it (move `created_at` back 31 minutes and reload); "edited"
   label; remove with confirm and cancel; policy and lock change saved;
   Load more after 20 posts; alias URL redirects to the handle URL; unknown
   post shows not found; muted owner shows the notice; a remote-region owner's
   posts render; cards on the blocks page.

## Tests

`playwright/ui/hub-posts.spec.ts`.

## Checks

- `make playwright-check`
- `make test-environment`, then `npx playwright test ui/hub-posts.spec.ts --workers=2`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Every T14 behavior maps to a named test.

## Carried over
