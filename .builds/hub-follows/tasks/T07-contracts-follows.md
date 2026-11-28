# T07 Contracts: Add Hub follows and relationship state

## Requirements

PST-FOL-001 to PST-FOL-012, PST-REL-001, PST-REL-005 to PST-REL-009,
PST-RPL-016

## Guides

`agent-guides/typespec.md`, `typespec/AGENTS.md`, `agent-guides/federation.md`,
`agent-guides/go.md`, `agent-guides/typescript.md`, `agent-guides/posts.md`

## Exemplars

- `typespec/hub/blocks/blocks.tsp` and companions (Hub routes, mesh routes,
  list shapes)
- `typespec/hub/posts/replies.tsp` (`Idempotency-Key`, `202`
  `Vetchium.Hub.Operations.PendingOperation`)
- `typespec/hub/profile/public.tsp` (`PublicProfile`)

## Steps

1. New `typespec/hub/follows/follows.tsp` (namespace `Vetchium.Hub.Follows`)
   and import it from `typespec/main.tsp`:
   - `model FollowUserRequest { user: Vetchium.Hub.Profile.ProfileAddress; }`
   - `enum FollowState { Pending: "pending", Following: "following" }`
   - `model FollowedUser { handle: Vetchium.Hub.HubHandle; state:
     FollowState; followed_at: utcDateTime; }`
   - `model ListFollowingRequest { pagination_key?: Vetchium.PaginationKey;
     @minValue(1) @maxValue(50) limit?: int32; }`
   - `model ListFollowingResponse { users: FollowedUser[]; following_count:
     int32; next_pagination_key?: Vetchium.PaginationKey; }`
   - interface at `@route("/api/hub/follows")`: `follow` (`/follow`,
     `Idempotency-Key` header with the same idempotency extensions as
     `posts/create`, `204` or `202` `PendingOperation`), `unfollow`
     (`/unfollow`, `204`), `list` (`/list`, `200`). Problems per the API
     table in `.builds/hub-follows/BRIEF.md`.
2. `typespec/hub/blocks/blocks.tsp`: replace `BlockState` and `/state` with
   `@route("/api/hub/relationships") interface RelationshipOperations {
   @route("/state") state(...) }` returning `model RelationshipState {
   follow: "none" | "pending" | "following"; blocked: boolean; muted:
   boolean; blocked_by_them: boolean; }` (use an enum
   `RelationshipFollow`).
3. `typespec/hub/profile/public.tsp`: add `enum FollowerRange { None:
   "none", From1: "1-9", From10: "10-99", From100: "100-999", From1000:
   "1000-9999", From10000: "10000-99999", From100000: "100000+" }` and
   `follower_range: FollowerRange;` to `PublicProfile`. Mesh profile
   responses carry it.
4. Mesh payloads in `typespec/hub/follows/mesh.tsp` (Go types the command
   and events use; no new mesh routes, the framework carries them):
   - `FollowSetCommand { follower_hub_user_did, follower_handle,
     follower_tenant_id, followee_hub_user_did, follow_seq: int64 }`
   - `FollowSetResult { following: boolean; posts: FollowBackfillPost[] }`
     with `FollowBackfillPost { post_id: Vetchium.Hub.Posts.PostID;
     created_at: utcDateTime; }`, `@maxItems(20)`
   - `FollowEndedEvent { follower_hub_user_did, followee_hub_user_did,
     follow_seq: int64 }`
   - `RelationshipChangedEvent { owner_hub_user_did, owner_handle,
     owner_tenant_id, remote_hub_user_did, blocked: boolean }`
5. `typespec/problem/hub/follows.tsp` with companions: `hub-follow-refused`
   (403), `hub-follow-blocked-by-you` (409), `hub-follow-conflict` (409),
   `hub-follow-limit-reached` (429), `hub-follow-unavailable` (503). Titles
   in user words, for example "You can't follow this user".
6. Go and TypeScript companions for every new and changed file, with
   validators. Keep `/api/hub/blocks/state` callers compiling by the
   smallest edit; T10 and T12 own the behavior.

## Tests

- `typespec/hub/follows/follows_test.go` and `follows.test.ts`: request
  validation (address, limit bounds), `FollowerRange` values.

## Checks

- `make typespec-check`, `make test-go`, `make test-go-static`,
  `make hub-ui-check`, `make playwright-check`
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- The contract matches the BRIEF API table for follows, relationships, and
  `follower_range`.

## Carried over
