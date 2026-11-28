# T19 Hub portal: Show the feed on Timeline

## Requirements

PST-UI-003, PST-UI-004, PST-UI-008, PST-UI-016, PST-TL-001, PST-TL-006

## Guides

`agent-guides/ui.md`, `agent-guides/ux.md`, `hub-ui/AGENTS.md`,
`agent-guides/typescript.md`, `agent-guides/writing.md`,
`agent-guides/posts.md`

## Exemplars

- `hub-ui/src/pages/TimelinePage.tsx`, `hub-ui/src/features/posts/PostsTab.tsx`
  (composer, upgrade prompt, Load more)

## Steps

1. `hub-ui/src/features/posts/queries.ts`: `useTimelineQuery` (infinite,
   `timeline/list`). Creating a post or quote, follow, unfollow, block,
   and mute invalidate it.
2. `TimelinePage.tsx`: heading and one sentence ("Your posts and the posts
   of people you follow"); the composer on Silver+ or the upgrade prompt;
   "N following" from the Timeline response (replaces the T12 interim
   count); the own Replies link; the feed of `PostCard`s with Load more
   while a next key exists; the PST-UI-016 empty state. No partial notice.
3. Locale keys in `en.ts`, `de.ts`, `ta.ts`; translate German and Tamil.
4. Look at loading, empty, populated, below-Silver, and 390px states in
   light and dark and in German.

## Tests

T20 covers the screens.

## Checks

- `make hub-ui-check`
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- Timeline shows the feed with the composer on top.

## Carried over
