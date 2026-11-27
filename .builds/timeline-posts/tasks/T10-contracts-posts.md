# T10 Contracts: Add Hub timeline posts

## Requirements

PST-GEN-001, PST-GEN-002, PST-GEN-003, PST-ID-003, PST-OWN-004, PST-POS-001 to
PST-POS-011, PST-BLK-005 (`muted`), PST-THR-007, PST-RD-003

## Guides

`agent-guides/typespec.md`, `typespec/AGENTS.md`, `agent-guides/posts.md`,
`agent-guides/hub-profile.md`

## Exemplars

- `typespec/hub/messages/` and `typespec/hub/profile/`
- `typespec/problem/hub/conversations.tsp` with `.go` and `.ts`
  (`hub-chat-request-limit-reached` is `429`)
- `typespec/hub/blocks/` from T04

## Steps

1. Problem types in a new `typespec/problem/hub/posts.tsp` (+ `.go`, `.ts`):
   | Type | Status |
   | --- | --- |
   | `hub-post-not-found` | 404 |
   | `hub-post-unavailable` | 503 |
   | `hub-post-limit-reached` | 429 |
   | `hub-post-edit-closed` | 409 |
   | `hub-post-conflict` | 409 |
   | `hub-post-replies-closed` | 409 |
   | `hub-post-reply-refused` | 403 |
   | `hub-post-quote-refused` | 403 |
   | `hub-reply-not-found` | 404 |
   Add all now so later tasks only use them.
2. Create `typespec/hub/posts/posts.tsp` (+ `.go`, `.ts`):
   - `scalar PostID extends string` with `@pattern("^[0-9a-v]{20}[0-9a-z]{20}$")`.
   - `const MaxBodyLength = 512` in Go and TS; `@maxLength(512)` on bodies.
   - Closed sets: `PostKind` (`post`, `quote`), `ReplyPolicy` and
     `QuotePolicy` (`everyone`, `nobody`).
   - `Post { post_id; owner: PostOwner; kind; body; reply_policy; quote_policy; locked: boolean; reply_count: int32; quote_count: int32; revision: int32; edited: boolean; created_at; edited_at? }`.
     `PostOwner { handle; alias?; display_name; picture_url? }`. Leave a
     comment that T23 adds `quote_target` and `embed`.
   - Requests: `CreatePostRequest { body; reply_policy?; quote_policy? }`,
     `EditPostRequest { post_id; body; revision: int32 }`,
     `RemovePostRequest { post_id }`,
     `SetPostPoliciesRequest { post_id; reply_policy; quote_policy; locked }`,
     `ListPostsRequest { owner: ProfileAddress; pagination_key?; limit? }`
     (default 20, max 50), `GetPostRequest { owner; post_id }`.
   - `ListPostsResponse { posts: Post[]; muted: boolean; next_pagination_key? }`.
3. Interface `@route("/api/hub/posts")`: `/create` (201), `/edit`, `/remove`
   (204), `/set-policies`, `/list`, `/get`. Unions per the BRIEF API table,
   plus `InvalidJSON`, `ValidationFailed`, `HubAuthenticationRequired`,
   `InternalServerError`, and `InvalidPaginationKey` for `/list`.
4. Profile cards in `typespec/hub/profile/`: `ReadCardsRequest { handles: Handle[] }`
   (1 to 50, distinct), `ProfileCard { handle; alias?; display_name; picture_url? }`,
   `ReadCardsResponse { cards: ProfileCard[]; unavailable: Handle[] }`.
   Route `/api/hub/profile/read-cards`. Mesh `/mesh/profile/read-cards` and
   `/api/mesh/profile/read-cards` with the viewer fields of `/mesh/profile/read`.
5. Mesh posts contract in `typespec/hub/posts/mesh.tsp` (+ companions):
   - `/mesh/posts/list` and `/api/mesh/posts/list`: owner DID, viewer DID and
     handle, pagination key, limit. Returns `MeshPost[]` (the `Post` fields
     plus `owner_hub_user_did`) and the next key.
   - `/mesh/posts/get-many` and `/api/mesh/posts/get-many`: up to 50
     `{ owner_hub_user_did, post_id }`. Each result is `found` (a `MeshPost`),
     `not-found`, or `not-homed`.
6. Companions: validation for every request (body length in code points,
   U+0000 refused, ID pattern, limit range, distinct handles). Update
   `typespec/package.json` exports.

## Tests

- `typespec/hub/posts/posts_test.go`, `posts.test.ts`: normalization on a
  copy (trim), each validation rule, 512 accepted and 513 refused with a
  multi-byte character, U+0000 refused.
- `typespec/problem/hub/posts` tests if the problem exemplar has them.

## Checks

- In `typespec/`: `npm run check:contract-files`, `npm run compile`,
  `npm run typecheck`, `npm run test:ts`
- `make typespec-check`, `make test-go GOTESTFLAGS='-p 2'`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Contracts compile; all nine problem types exist.

## Carried over
