# T16 Workers: Fan out posts to followers and trim Timelines

## Requirements

PST-TL-002 to PST-TL-005, PST-TL-007 to PST-TL-009, PST-FOL-006,
PST-FOL-007, PST-FOL-013, PST-REL-006, PST-GEN-004

## Guides

`agent-guides/federation.md`, `agent-guides/backend.md`, `agent-guides/go.md`,
`agent-guides/database.md`, `agent-guides/posts.md`

## Exemplars

- `backend/internal/workers/clean_removed_hub_posts.go` (one step per
  commit, cursor, audit)
- `backend/internal/workers/purge_hub_posts.go` (daily batches)
- `backend/internal/workers/workers.go` (job registration)
- `backend/internal/hubquotes/hubquotes.go` (event enqueue and receiver)

## Steps

1. In `backend/internal/hubfollows`, replace the T09 no-op variables:
   `InsertTimelineEntries` calls `InsertHubTimelineEntries` then
   `TrimHubTimeline`; `DeleteTimelineEntries` calls
   `DeleteHubTimelineEntriesByAuthor`. Delete the variables; call the
   queries directly.
2. Event `hub-timeline-post-added` in `hubfollows` (`RegisterEvents`):
   receiver per PST-TL-005 (`GetHubRelationshipCopy` must be `following`),
   origin `author_hub_user_did`. Export `EnqueueTimelinePost`.
3. `backend/handlers/hub/posts/posts.go` `Create` and
   `backend/handlers/hub/posts/quotes.go` `CreateQuote`: insert the author's
   own entry in the post's transaction (PST-TL-002).
4. Job `fan-out-hub-posts` in
   `backend/internal/workers/fan_out_hub_posts.go`, every minute, per
   PST-TL-003: one post and one page of 1,000 followers per commit;
   enqueue with aggregate `hub_post`, the post ID, and the post `version`;
   audit `hub.post.fanned-out` with the count; a post not `live` is marked
   done.
5. Job `trim-hub-timelines` in
   `backend/internal/workers/trim_hub_timelines.go`, daily, per PST-TL-008
   (90 days, 24 hours, 1,000 rows of one table per commit, audit each
   commit).
6. Register both jobs in `workers.go`.
7. Add a `docs/todo.md` item under the timeline posts entry: fan-out sends
   one event per follower; consider a gRPC stream or a shared firehose for
   large accounts (PST-TL-009).

## Tests

- `backend/internal/workers/fan_out_hub_posts_integration_test.go`: 2,500
  followers give 3 commits and 2,500 events; a removed post is marked done
  with none.
- `backend/internal/hubfollows/hubfollows_integration_test.go`: the
  receiver inserts only for a `following` copy; trims to 1,000; follow
  backfill inserts entries; unfollow and the block receiver delete them.
- `backend/internal/workers/trim_hub_timelines_integration_test.go`.
- `backend/handlers/hub/posts/posts_test.go`: create inserts the own entry.

## Checks

- `cd backend && go test ./internal/hubfollows/... ./internal/workers/...`
- `make test-go`, `make test-go-static`, `make test-go-lint`
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- Two jobs and one event are registered; every commit audits.

## Carried over
