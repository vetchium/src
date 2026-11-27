# T31 Build: Finish the timeline posts build

## Requirements

All `PST-*` requirements in `agent-guides/posts.md`

## Guides

`agent-guides/feature-build.md` (final task rules), `agent-guides/review.md`,
`agent-guides/verification.md`

## Exemplars

- `README.md` sections for seeded accounts and workers jobs
- `docs/todo.md` existing entries

## Steps

1. `README.md`: list the new worker jobs (`reap-hub-pending-replies`,
   `clean-removed-hub-posts`, `purge-hub-posts`) where jobs are listed, and
   the seeded posts, if seeded accounts are listed.
2. `docs/todo.md`: add each out-of-scope item from `BRIEF.md` as one short
   entry under the right heading.
3. `docs/messaging-brainstorm.md`:
   - In "Status", state that `agent-guides/posts.md` is the rule for build
     order steps 1–5.
   - Change P1 and P5 to note the reply copy in the post owner's tenant
     (PST-OWN-001).
   - Mark steps 1–5 in section 9 as built.
   - Remove the settled rows D1, D7, D16, D17, D18, D19, D21, D23, D24, D25,
     D26, D27 from section 10. Keep D12 with "Deferred".
4. Map every `PST-*` ID to at least one named test. Write the map in
   `.builds/timeline-posts/review.md` during the review phase. Add any
   missing test.
5. Run `make test` once. Fix only failures this branch caused.
6. The commit script removes `.builds/timeline-posts/` after this task.

## Tests

No new tests unless step 4 finds a gap.

## Checks

- `make test` (a failure only in `video-demos` checks does not block; then
  run `make -k test-static-ready`, `make test-environment`, and
  `make playwright-test-run`)
- `make fmt`, `git diff --check`

## Acceptance

- `README.md`, `docs/todo.md`, and the brainstorm are current.
- `make test` passes.

## Carried over

From T06: `playwright/ui/hub-plans.spec.ts` has two date-sensitive tests that fail when the local timezone (IST) has passed midnight and UTC has not. They pass with `TZ=UTC`. Add this pre-existing flake to `docs/todo.md`.
