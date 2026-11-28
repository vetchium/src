# T11 Playwright: Test Hub follow and block APIs

## Requirements

PST-FOL-001, PST-FOL-004 to PST-FOL-012, PST-REL-003, PST-REL-005 to
PST-REL-012, PST-RPL-016

## Guides

`agent-guides/playwright.md`, `playwright/AGENTS.md`, `agent-guides/posts.md`

## Exemplars

- `playwright/api/hub-blocks.spec.ts`, `playwright/lib/hub-blocks.ts`
- `playwright/api/hub-post-replies.spec.ts` (scenario tables, `setHubHome`
  for a region that does not answer, operation status polling)

## Steps

1. New `playwright/lib/hub-follows.ts` with `HubFollowsAPI` (`follow`,
   `unfollow`, `list`, `state`) and `expectFollowing`.
2. New `playwright/api/hub-follows.spec.ts`, each test for scenarios "same
   region" (`sgp`, `sgp`) and "cross region" (`sgp`, `usa1`):
   - follow then `relationships/state` reads `following`; repeat is `204`;
     the same key replays; `follows/list` shows the user with
     `following_count` 1; `profile/read` of the followed user reads
     `follower_range` `1-9`.
   - self follow is `validation-failed`; unknown address
     `hub-profile-not-found`.
   - A blocks B: B's follow of A is `hub-follow-refused`; B's
     `relationships/state` reads `blocked_by_them` true; A's state toward B
     reads `blocked`; A following B is `hub-follow-blocked-by-you`; A's
     follow of B and B's follow of A both ended; follower ranges go to
     `none`.
   - unblock restores no follow; B may follow again.
   - mute while following ends the follow; follow while muted unmutes.
   - unfollow ends the follow and the range drops.
   - B cannot edit an existing reply on A's post after A blocks B
     (`hub-post-reply-refused`); B can still remove it.
   - followee region down: follow answers `202`; after the region returns
     and recovery runs, state reads `following`.
3. The 200-a-day and 5,000 limits: one test that inserts 200 log rows
   through the test database helper used by other limit tests
   (`git grep -n "hub-post-limit-reached" playwright`) and expects
   `hub-follow-limit-reached`.
4. Update `playwright/api/hub-blocks.spec.ts` for `relationships/state`.

## Tests

The steps above.

## Checks

- `make playwright-check`
- `make test-environment`, then `npx playwright test api/hub-follows.spec.ts
  api/hub-blocks.spec.ts api/hub-post-replies.spec.ts` in `playwright/`
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- Contract coverage lists the four new operations.

## Carried over
