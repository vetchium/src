# T12 Hub portal: Add Follow, the Following page, and blocked states

## Requirements

PST-UI-008, PST-UI-011 to PST-UI-015, PST-UI-010, PST-FOL-011,
PST-FOL-012, PST-REL-008, PST-REL-013

## Guides

`agent-guides/ui.md`, `agent-guides/ux.md`, `hub-ui/AGENTS.md`,
`agent-guides/typescript.md`, `agent-guides/writing.md`,
`agent-guides/posts.md`

## Exemplars

- `hub-ui/src/pages/ProfileViewPage.tsx` (`BlockMenu`, header, tabs)
- `hub-ui/src/features/blocks/queries.ts`
- `hub-ui/src/pages/BlocksPage.tsx` (a list of users with cards and Load
  more)
- `hub-ui/src/components/common/AppShell.tsx` (sidebar selection)
- `hub-ui/src/features/posts/queries.ts` (idempotency key kept across
  retries, `202` polling)

## Steps

1. New `hub-ui/src/features/follows/queries.ts`:
   `useRelationshipStateQuery` (replaces `useBlockStateQuery`),
   `useFollowMutation` (keeps the key until success, polls a `202` like a
   reply does), `useUnfollowMutation`, `useFollowingQuery` (infinite).
   Each mutation invalidates relationship state, the following list, the
   profile, and the Timeline queries.
2. `ProfileViewPage.tsx` for another user:
   - Under the name: the follower range text (`follows.range.*`).
   - A `FollowButton`: Follow / "Follow pending" + Unfollow / Unfollow per
     PST-UI-011. On a muted user, Follow opens a confirm "Follow and
     unmute". When `blocked_by_them`, replace it with the PST-UI-012 text.
     When `blocked`, disable it and show the PST-UI-013 text with an
     Unblock button.
   - `BlockMenu`: the Block dialog says the block ends follows both ways;
     Mute asks first when `follow` is `following`.
   - For the own profile: the follower range and "N following" linking to
     `/following`.
3. New `hub-ui/src/pages/FollowingPage.tsx` at `/following`
   (`hub-ui/src/app/App.tsx`): breadcrumb Timeline, level-1 "Following",
   one sentence, the list with cards from `read-cards`, state tag for
   pending, Unfollow per row, Load more, empty state "You don't follow
   anyone yet".
4. `TimelinePage.tsx`: add the "N following" link to `/following` (count
   from `follows/list` with `limit: 1` until T19 adds `following_count` to
   the Timeline response; T19 switches it).
5. `AppShell.tsx`: select "Timeline" on `/following`.
6. `PostCard.tsx`, `PostPage.tsx`, `Thread.tsx`: when `blocked_by_owner`,
   show the PST-UI-012 text in place of the reply composer and hide Quote;
   in the thread, hide the sub-reply composer and Edit of the viewer's own
   reply below a reply whose `blocked_by_author` is true and show the text.
7. Locale keys in `en.ts`, `de.ts`, `ta.ts` under `follows.*`; German and
   Tamil translated.
8. Look at each state from `ux.md` "Before building" on the dev stack, in
   light and dark, at 390px, and in German.

## Tests

T13 covers the screens. Fix any UI spec that broke from the replaced
`blocks/state`.

## Checks

- `make hub-ui-check`
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- Every new screen and action has its click path from Home.

## Carried over
