# T14 Hub portal: Add the profile Posts tab and post page

## Requirements

PST-POS-004 to PST-POS-011, PST-BLK-005, PST-BLK-007 (cards in the blocks
list), PST-THR-006, PST-UI-001, PST-UI-002, PST-UI-004, PST-UI-005, Hub
portal rows `/u/:address` and `/u/:address/posts/:postId` (post only)

## Guides

`agent-guides/ui.md`, `agent-guides/ux.md`, `agent-guides/typescript.md`,
`agent-guides/posts.md`

## Exemplars

- `hub-ui/src/pages/ProfileViewPage.tsx`, `hub-ui/src/features/profile/`
- `hub-ui/src/pages/OrgOpeningPage.tsx` (detail page with an address in the
  route)
- `hub-ui/src/app/PendingOperationContext.tsx`
- `hub-ui/src/i18n/locales/en.ts`, `de.ts`, `ta.ts`

## Steps

1. `hub-ui/src/features/posts/queries.ts`: hooks for T10 operations and
   `read-cards`.
2. `hub-ui/src/features/posts/PostCard.tsx`: owner card, body as plain text
   with line breaks, "edited", relative time, reply and quote counts (links
   added in T21 and T27).
3. `hub-ui/src/features/posts/PostComposer.tsx`: body with a live code point
   counter (512), reply and quote policy selects, submit, field errors, and
   `hub-post-limit-reached` text.
4. On `ProfileViewPage.tsx` add tabs Profile and Posts (Replies comes in
   T21). Posts shows the composer for the Silver+ owner, an upgrade prompt
   for the owner below Silver, the list with Load more, and the muted notice
   "You muted this user" when `muted` is true.
5. `hub-ui/src/pages/PostPage.tsx` at `u/:address/posts/:postId`. It shows
   the post. The author gets Edit (inside 30 minutes only), Remove (with
   confirmation), and a policy and lock form. An alias in the URL redirects
   to the handle URL (PST-UI-001). `hub-post-not-found` shows a not-found
   state.
6. On `BlocksPage.tsx`, show display names and pictures from `read-cards`
   after the handles render.
7. Add all strings to `en.ts`, `de.ts`, `ta.ts` under `posts`.

## Tests

UI specs come in T15.

## Checks

- `make hub-ui-check`, `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- The Posts tab and post page work against the T12 API.

## Carried over
