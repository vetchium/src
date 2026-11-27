# T07 Playwright: Test Hub block and mute APIs

## Requirements

PST-BLK-001, PST-BLK-004, PST-BLK-006, PST-BLK-007, PST-BLK-008, PST-RD-003

## Guides

`agent-guides/playwright.md`, `playwright/AGENTS.md`,
`agent-guides/typescript.md`, `agent-guides/posts.md`

## Exemplars

- `playwright/api/hub-chat-requests.spec.ts`
- `playwright/api/hub-profile-read-alias.spec.ts` (cross-region users)
- `playwright/api/mesh.spec.ts` (mesh peer calls)
- `playwright/lib/hub-api.ts`, `playwright/lib/hub-signup.ts`

## Steps

1. Add client helpers for the seven operations to `playwright/lib/hub-api.ts`
   (or a new `playwright/lib/hub-blocks.ts`).
2. Create `playwright/api/hub-blocks.spec.ts`. Use two users in the same
   region and one in another region.
3. Cover every non-`5xx` response in each operation's union: `204` block,
   repeat block `204` with one audit event, unblock, unblock of a user not
   blocked `204` with no audit event, `hub-profile-not-found`,
   self-block `validation-failed`, invalid JSON, missing session
   `hub-authentication-required`, list keyset paging with limit 1, limit 0 and
   51 refused, tampered key `invalid-pagination-key`, state before and after,
   alias address resolves to the handle. The same for mutes.
4. Mesh: call `/api/mesh/blocks/check` with a viewer the calling tenant does
   not home and assert the refusal, as `mesh.spec.ts` does for profiles.
5. Assert the blocked user sees no change (state of the blocked side is
   empty).

## Tests

`playwright/api/hub-blocks.spec.ts` (this task).

## Checks

- `make playwright-check`
- `make test-environment`, then in `playwright/`:
  `npx playwright test api/hub-blocks.spec.ts --workers=2`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Every block and mute contract response maps to a named test.

## Carried over
