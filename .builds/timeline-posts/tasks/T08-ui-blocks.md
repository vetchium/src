# T08 Hub portal: Add blocks and mutes

## Requirements

PST-BLK-004, PST-BLK-006, PST-BLK-007, PST-BLK-008, Hub portal table rows
`/settings/blocks` and `/u/:address` (menu only)

## Guides

`agent-guides/ui.md`, `agent-guides/ux.md`, `agent-guides/typescript.md`,
`agent-guides/posts.md`, `hub-ui/AGENTS.md` if present

## Exemplars

- `hub-ui/src/pages/WorkEmailsPage.tsx` and `hub-ui/src/pages/PreferencesPage.tsx`
  (settings pages)
- `hub-ui/src/components/common/AppShell.tsx` (settings menu entries near
  `/settings/preferences`)
- `hub-ui/src/pages/ProfileViewPage.tsx`, `hub-ui/src/features/profile/queries.ts`
- `hub-ui/src/i18n/locales/en.ts`, `de.ts`, `ta.ts`

## Steps

1. Create `hub-ui/src/features/blocks/queries.ts` with query and mutation
   hooks for the seven operations (copy the pattern in
   `features/profile/queries.ts`).
2. Create `hub-ui/src/pages/BlocksPage.tsx` at route `settings/blocks` in
   `hub-ui/src/app/App.tsx`. Two sections: "Blocked users" and "Muted users".
   Each row links the handle to `/u/<handle>` and has Unblock or Unmute. Each
   list has "Load more" while a next key exists. Empty state text for each.
3. Add the settings menu entry "Blocks and mutes" to `AppShell.tsx`, after
   Preferences.
4. On `ProfileViewPage.tsx`, for another user's profile, add a menu with
   Block or Unblock and Mute or Unmute from `/api/hub/blocks/state`. Ask for
   confirmation before Block. Show a success message after each action. Hide
   the menu on the viewer's own profile.
5. Add every string to `en.ts`, `de.ts`, and `ta.ts` under a `blocks` key.

## Tests

UI specs come in T09. Add unit tests only for non-trivial helpers.

## Checks

- `make hub-ui-check`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- The page and the menu work against the T06 API in `make test-environment`.

## Carried over
