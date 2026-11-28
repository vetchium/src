# T22 Build: Finish the Hub follows build

## Requirements

All `PST-*` IDs added or changed by this build.

## Guides

`agent-guides/feature-build.md`, `agent-guides/review.md`,
`agent-guides/verification.md`, `agent-guides/writing.md`

## Exemplars

- The finish task of the timeline posts build (`git show 8e1da4b --
  .builds/timeline-posts/tasks/T31-finish.md`)

## Steps

1. `git grep -n -i "reply_policy\|quote_policy\|locked_at\|detach\|set-policies\|blocks/state\|hub_user_blocks"`
   finds nothing outside `video-demos/` and `.builds/`.
2. `docs/todo.md`: rewrite the "Timeline posts, not built" item for what is
   now built (follows and the feed are done); keep reactions, media,
   mentions, notifications, takedown, communities, votes, DMs, Org posts,
   public pages, old revisions. Rewrite "Hub post discovery": follows
   exist; user search and follow suggestions are deferred. Add: follow
   notifications and requests; relationship and Timeline cleanup on
   account deletion; tag pages and filters. Keep the fan-out item from
   T16.
3. `README.md`: new jobs (`fan-out-hub-posts`, `trim-hub-timelines`) if the
   README lists jobs; seeded follows.
4. Run `make test`. When only `video-demos-check-ready` fails, run
   `make -k test-static-ready`, `make test-environment`, and
   `make playwright-test-run` instead and record that.
5. The commit script removes `.builds/hub-follows/`.

## Tests

The full suite.

## Checks

- `make test` (or the three targets in step 4)

## Acceptance

- `make test` passes; no stale references remain; `docs/todo.md` is
  current.

## Carried over
