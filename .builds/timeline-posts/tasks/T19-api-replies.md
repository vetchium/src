# T19 Hub API: Serve replies and the Replies tab

## Requirements

PST-RPL-001 to PST-RPL-005, PST-RPL-010 to PST-RPL-012, PST-RPL-014,
PST-THR-001 to PST-THR-005, PST-THR-008, PST-TAB-001 to PST-TAB-003,
PST-BLK-002, PST-BLK-005, PST-RD-003, PST-RD-004, PST-GEN-004

## Guides

`agent-guides/backend.md`, `agent-guides/go.md`, `agent-guides/database.md`,
`agent-guides/federation.md`, `agent-guides/posts.md`

## Exemplars

- `backend/handlers/hub/messages/messages.go` (`reply-to-conversation`:
  idempotency key, `Sender.Send`, `202` pending, replay)
- `backend/handlers/hub/posts/posts.go` (T12), `backend/internal/postsclient`
- `backend/internal/blocksclient` (T06), `backend/internal/hubreplies` (T18)
- `backend/handlers/mesh/posts.go` (T12)

## Steps

1. Add to `backend/handlers/hub/posts/`: `Reply`, `EditReply`,
   `RemoveReply`, `HideReply`, `UnhideReply`, `ListReplies`,
   `ListAuthorReplies`.
2. `Reply`:
   1. Resolve `owner` to the post owner (DID, handle, tenant).
   2. For a parent, read it with `/mesh/posts/get-reply` (local query when
      the owner is local). Not found → `hub-reply-not-found`. If the parent
      author is not the post owner and not the replier, call
      `blocksclient.Check(parent author, replier)` (local query when local).
      Blocked → `hub-post-reply-refused`. Failure → `hub-post-unavailable`.
   3. Mint the reply ID with `postid.New`. Call `Sender.Send` with kind
      `hub-post-reply-register`, authority the post owner, aggregate the post
      ID, `RequestDigest` over the browser request, and
      `Prepare: hubreplies.Prepare(...)`.
   4. Map outcomes: succeeded → `200` `Reply` (state `live`); failed → the
      stored problem; pending → `202`; unavailable → `hub-post-unavailable`.
3. `EditReply` and `RemoveReply`: own reply in `hub_reply_texts`; map zero
   rows as in T12; enqueue `hub-reply-edited` or `hub-reply-removed` in the
   same transaction with `hubreplies.EnqueueEdited` or `EnqueueRemoved`;
   audit `hub.reply.edited` or `hub.reply.removed`.
4. `HideReply` and `UnhideReply`: the caller must own the post (local post
   only; else `hub-post-not-found`). Change `live` ↔ `hidden_by_owner` and
   apply the count rule; audit `hub.post.reply-hidden` or
   `hub.post.reply-unhidden`. A repeat is `204` with no audit.
5. `ListReplies`: local owner → database; remote owner →
   `/mesh/posts/list-replies`. The serving tenant shapes rows per
   PST-THR-003 and PST-THR-004 for the verified viewer. The viewer's
   hub-api then filters out authors in `HubUserMutedAny`. A removed post →
   `hub-post-not-found`.
6. `ListAuthorReplies`: muted owner → `muted: true`, no items. Otherwise a
   local read or `/mesh/posts/list-author-replies`.
7. Mesh relay and peer handlers for `list-replies`, `get-reply`, and
   `list-author-replies` in `backend/handlers/mesh/posts.go`, with viewer
   verification.
8. In `Remove` (T12), nothing more: the T18 job does cleanup.
9. Register routes.

## Tests

- Unit tests for outcome mapping and the thread row shaping in
  `backend/handlers/hub/posts/replies_test.go`.
- API tests come in T20.

## Checks

- `cd backend && go test ./handlers/...`
- `make test-go GOTESTFLAGS='-p 2'`, `make test-go-static`, `make test-go-lint`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Every T16 operation is routed and returns only contract responses.

## Carried over
