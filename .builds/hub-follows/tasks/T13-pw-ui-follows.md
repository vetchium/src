# T13 Playwright: Test the follow and block screens

## Requirements

PST-UI-008, PST-UI-011 to PST-UI-015

## Guides

`agent-guides/playwright.md`, `playwright/AGENTS.md`, `agent-guides/ux.md`,
`agent-guides/posts.md`

## Exemplars

- `playwright/ui/hub-blocks.spec.ts`, `playwright/ui/hub-profile-view.spec.ts`,
  `playwright/ui/hub-post-journeys.spec.ts`

## Steps

1. New `playwright/ui/hub-follows.spec.ts`:
   - Follow from another user's profile (reached through a post author
     link from Sidebar "Timeline"); the button reads Unfollow; the range
     reads "1–9 followers".
   - "N following" on Timeline opens `/following` with the user; Unfollow
     removes the row; the sidebar selects Timeline on `/following`.
   - Follow on a muted user shows the unmute dialog.
   - Mute while following asks first.
   - Blocked by the other user: the profile, the post page, and a thread
     show "You can't follow, reply to, or quote this user"; no Quote
     button.
   - The viewer blocked the other user: Follow is disabled with the reason
     and an Unblock button that works.
   - A `202` follow (the other region stopped) shows "Follow pending".
   - 390px width: the profile header and the Following list fit.
2. `playwright/ui/hub-post-journeys.spec.ts`: the journey Home → Sidebar
   "Timeline" → "N following" → `/following`.

## Tests

The steps above.

## Checks

- `make playwright-check`
- `make test-environment`, then `npx playwright test ui/hub-follows.spec.ts
  ui/hub-post-journeys.spec.ts ui/hub-blocks.spec.ts` in `playwright/`
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- Each UI rule above has a passing test.

## Carried over
