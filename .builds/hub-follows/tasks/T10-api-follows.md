# T10 Hub API: Serve follows, relationship state, and block freezes

## Requirements

PST-FOL-001, PST-FOL-003, PST-FOL-007, PST-FOL-011, PST-FOL-012,
PST-REL-003, PST-REL-005, PST-REL-007 to PST-REL-012, PST-RPL-016,
PST-POS-009, PST-THR-010, PST-GEN-004

## Guides

`agent-guides/backend.md`, `agent-guides/go.md`, `agent-guides/federation.md`,
`agent-guides/database.md`, `agent-guides/posts.md`

## Exemplars

- `backend/handlers/hub/blocks/blocks.go` (`Lookup`, `resolve`, list
  handlers, state handler)
- `backend/handlers/hub/posts/replies.go` (`Sender.Send` with `Prepare`,
  `202` handling, idempotency)
- `backend/handlers/mesh/profile.go` (builds `PublicProfile`)

## Steps

1. New `backend/handlers/hub/follows/follows.go`:
   - `Follow`: resolve the address with `blocks.Lookup` (self is
     `validation-failed`); read the copy seq; `Sender.Send` kind
     `hub-follow-set` with `hubfollows.Prepare`; retry up to 3 times on
     `hub-follow-conflict`; map outcomes: success `204`, pending `202`,
     unavailable `hub-follow-unavailable`, failed → the stored problem.
   - `Unfollow`: find the copy by stored handle first (as unblock does),
     else resolve; call `hubfollows.Unfollow` in one transaction; `204`.
   - `List`: `ListHubFollowing` keyset with purpose `hub:follows:list`,
     `CountHubFollowing`.
2. `backend/handlers/hub/blocks/blocks.go`: block, unblock, and mute call
   `hubfollows.Block`, `Unblock`, and `Mute`. Replace the state handler
   with `/api/hub/relationships/state` per PST-REL-009 (local reads only).
3. Register `/api/hub/follows/follow`, `/unfollow`, `/list`, and
   `/api/hub/relationships/state` in the hub-api routes; remove
   `/api/hub/blocks/state`.
4. `backend/handlers/mesh/profile.go`: set `follower_range` from
   `GetHubFollowerCount` per PST-FOL-011 with a Go function
   `FollowerRange(count int32)`.
5. Posts: in every hub-api handler that returns `Post` or `Reply` to the
   browser, fill `blocked_by_owner` and `blocked_by_author` with one
   `HubBlockedByAny` call per response (PST-RD-002). Carried over from T03.
6. `backend/handlers/hub/posts/replies.go` `EditReply`: before the write,
   refuse with `hub-post-reply-refused` when `HubBlockedByAny(author,
   [post owner, parent author])` returns any DID (PST-RPL-016).

## Tests

- `backend/handlers/hub/follows/follows_test.go`: outcome mapping (204,
  202, 503, stored 403, 409, 429), retry on conflict stops at 3.
- `backend/handlers/mesh/profile_test.go`: `FollowerRange` boundaries 0, 1,
  9, 10, 99, 100, 99999, 100000.
- `backend/handlers/hub/posts/replies_test.go`: edit refused by a block
  copy for the post owner and for the parent author; removal still allowed.

## Checks

- `cd backend && go test ./handlers/hub/... ./handlers/mesh/...`
- `make test-go`, `make test-go-static`, `make test-go-lint`
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- The four operations and `follower_range` are served per the contract.

## Carried over
