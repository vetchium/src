# T17 Hub API: Serve the Timeline

## Requirements

PST-TL-001, PST-TL-006, PST-RD-001 to PST-RD-003, PST-POS-009,
PST-REL-008

## Guides

`agent-guides/backend.md`, `agent-guides/go.md`, `agent-guides/federation.md`,
`agent-guides/posts.md`

## Exemplars

- `backend/handlers/hub/posts/quotes.go` `ListQuotes` (fan-out read of
  posts from many tenants with `/mesh/posts/get-many`, embeds, cards)
- `backend/internal/fanout`, `backend/internal/postsclient`

## Steps

1. New `backend/handlers/hub/posts/timeline.go` `ListTimeline`:
   `ListHubTimelineEntries` (purpose `hub:timeline:list`), group references
   by author tenant hint, read with `postsclient.GetMany` through
   `fanout` (2-second deadline, `not-homed` re-resolve once), drop
   not-found and unavailable results with no notice, keep entry order,
   attach embeds and owner cards the way `ListQuotes` does, fill
   `blocked_by_owner`, return `following_count` (`CountHubFollowing`). The
   next key comes from the last entry read, not the last post returned.
2. Register `/api/hub/timeline/list`.
3. `hub-ui`: none in this task.

## Tests

`backend/handlers/hub/posts/timeline_test.go`: a removed post and an
unavailable region are left out and the next key still advances; order
across two tenants; `following_count`.

## Checks

- `cd backend && go test ./handlers/hub/posts/...`
- `make test-go`, `make test-go-static`, `make test-go-lint`
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- `/api/hub/timeline/list` serves the T14 contract.

## Carried over
