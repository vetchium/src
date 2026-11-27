# T16 Contracts: Add Hub post replies

## Requirements

PST-GEN-003, PST-RPL-001 to PST-RPL-005, PST-RPL-010 to PST-RPL-013,
PST-RPL-015, PST-THR-001 to PST-THR-005, PST-THR-008, PST-TAB-001,
PST-TAB-002, PST-BLK-005, PST-RD-003

## Guides

`agent-guides/typespec.md`, `typespec/AGENTS.md`, `agent-guides/federation.md`,
`agent-guides/posts.md`

## Exemplars

- `typespec/hub/messages/` (`/reply-to-conversation`: `Idempotency-Key`
  header, `x-vetchium-idempotency-*` extensions, `PendingMessageResponse`)
- `typespec/federation/hiring.tsp`, `hiring.go`, `hiring.ts` (command
  payloads, result models, `...Kind` constants, rejection models)
- `typespec/hub/posts/` from T10

## Steps

1. In `typespec/hub/posts/replies.tsp` (+ companions):
   - `ThreadReplyState`: `live`, `hidden` (only its author sees it),
     `placeholder`.
   - `Reply { reply_id: PostID; post_id; parent_reply_id?; author_handle; body?; state: ThreadReplyState; child_count: int32; revision: int32; edited: boolean; created_at }`.
     `body` is absent for `placeholder`.
   - `ReplyRequest { owner: ProfileAddress; post_id; parent_reply_id?; body }`
     with `Idempotency-Key`. Success `200` `Reply`, or `202`
     `Vetchium.Hub.Operations.PendingOperation`.
   - `EditReplyRequest { reply_id; body; revision }` → `200` `Reply`.
   - `RemoveReplyRequest { reply_id }` → `204`.
   - `HideReplyRequest { post_id; reply_id }` for `/hide-reply` and
     `/unhide-reply` → `204`.
   - `ListRepliesRequest { owner; post_id; parent_reply_id?; pagination_key?; limit? }`
     (default 20, max 50) → `{ replies: Reply[]; next_pagination_key? }`.
   - `AuthorReplyState`: `live`, `post_removed`.
     `AuthorReply { reply_id; post_id; post_owner_handle; body; state; edited; created_at }`.
     `ListAuthorRepliesRequest { owner; pagination_key?; limit? }` →
     `{ replies: AuthorReply[]; muted: boolean; next_pagination_key? }`.
   - Add the operations to the `/api/hub/posts` interface with the BRIEF
     problem unions.
2. Mesh in `typespec/hub/posts/mesh.tsp`: relay and peer pairs for
   `list-replies` (adds `author_hub_user_did` to each item, for mute
   filtering), `get-reply` (returns `author_hub_user_did`,
   `author_tenant_id`, `author_handle`, `state`, `parent_reply_id?`), and
   `list-author-replies`. Each request carries the viewer DID and handle.
3. Federation in `typespec/federation/posts.tsp` (+ `.go`, `.ts`):
   - Command `HubPostReplyRegisterKind = "hub-post-reply-register"`. Payload
     `{ post_id; reply_id; parent_reply_id?; replier_hub_user_did; replier_handle; body; created_at }`.
     Result `200` `{ reply_id; created_at }`. Rejections: the five reply
     problems from the BRIEF table.
   - Events `HubReplyEditedKind` (`hub-reply-edited`) payload
     `{ post_id; reply_id; body; revision }`; `HubReplyRemovedKind`
     (`hub-reply-removed`) payload `{ post_id; reply_id }`;
     `HubPostRemovedKind` (`hub-post-removed`) payload `{ post_id }`.
   - Aggregate type constants `AggregateHubReply = "hub_reply"` and
     `AggregateHubPost = "hub_post"`.
4. Companions with validation; `typespec/package.json` exports.

## Tests

- `typespec/hub/posts/replies_test.go`, `replies.test.ts`: every validation
  rule.
- `typespec/federation/posts_test.go`, `posts.test.ts`: kinds pass
  `IsCommandKind` and `IsEventKind`; payload validation.

## Checks

- In `typespec/`: `npm run check:contract-files`, `npm run compile`,
  `npm run typecheck`, `npm run test:ts`
- `make typespec-check`, `make test-go GOTESTFLAGS='-p 2'`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Contracts compile; federation kinds and payloads exist.

## Carried over
