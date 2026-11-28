# T14 Contracts: Add the Hub Timeline list

## Requirements

PST-TL-001, PST-TL-004, PST-TL-006

## Guides

`agent-guides/typespec.md`, `typespec/AGENTS.md`, `agent-guides/go.md`,
`agent-guides/typescript.md`, `agent-guides/posts.md`

## Exemplars

- `typespec/hub/posts/posts.tsp` (`ListPostsRequest`, `ListPostsResponse`)
- `typespec/hub/follows/mesh.tsp` (event payload models from T07)

## Steps

1. New `typespec/hub/posts/timeline.tsp` (namespace `Vetchium.Hub.Posts`),
   imported from `typespec/main.tsp`:
   - `model ListTimelineRequest { pagination_key?: Vetchium.PaginationKey;
     @minValue(1) @maxValue(50) limit?: int32; }` (default 20)
   - `model ListTimelineResponse { posts: Post[]; following_count: int32;
     next_pagination_key?: Vetchium.PaginationKey; }` with a doc comment:
     a page can be short; the list ends only when the key is absent.
   - `@route("/api/hub/timeline") interface TimelineOperations {
     @route("/list") @post list(...) }` with `200`, `PostErrors`, and
     `InvalidPaginationKeyErrorResponse`.
2. Add `TimelinePostAddedEvent { author_hub_user_did, author_handle,
   author_tenant_id, post_id: PostID, post_created_at: utcDateTime }` to
   `typespec/hub/follows/mesh.tsp`.
3. Go and TypeScript companions with validators and tests.

## Tests

- `typespec/hub/posts/timeline_test.go` and `timeline.test.ts`: limit
  bounds, pagination key shape.

## Checks

- `make typespec-check`, `make test-go`, `make test-go-static`,
  `make hub-ui-check`
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- The Timeline contract matches the BRIEF API table.

## Carried over
