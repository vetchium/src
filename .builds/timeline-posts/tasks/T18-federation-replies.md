# T18 Federation: Register replies across tenants

## Requirements

PST-OWN-001, PST-OWN-002, PST-RPL-001, PST-RPL-003, PST-RPL-005 to
PST-RPL-015, PST-POS-007 (cleanup), PST-GEN-004

## Guides

`agent-guides/federation.md`, `agent-guides/backend.md`, `agent-guides/go.md`,
`agent-guides/database.md`, `agent-guides/posts.md`

## Exemplars

- `backend/internal/agencyconversations/commands.go` (command handler,
  `Rejected`, audit in the handler transaction)
- `backend/internal/hubapplications/hubapplications.go:351`
  (`registry.ShareWatermark`, event receivers, `Origin`)
- `backend/internal/federation/commandkinds/registry.go`,
  `backend/internal/federation/eventkinds/registry.go`
- `backend/internal/workers/expire_chat_requests.go`,
  `backend/internal/workers/workers.go` (job registration)
- The T02 hooks in `backend/internal/federation/commands`

## Steps

1. Create package `backend/internal/hubreplies`.
2. `Register(ctx, tx, command)` handler for `hub-post-reply-register`
   (authority: post owner). In one transaction:
   lock the post (`GetHubPostForReply`); refuse per PST-RPL-003 in that
   order; check `HubUserBlockExists(post owner, replier)`; for a parent, lock
   it. A parent not in the post or not `live` → `hub-reply-not-found`. A
   parent that is a sub-reply → `validation-failed` on `parent_reply_id`.
   Insert the structure row with the reply copy;
   adjust counts; audit `hub.post.reply-registered`. Return `Succeeded(200, result)`.
   Initiator: the replier Hub user.
3. Register the kind in `commandkinds/registry.go`. Register a `SettleFunc`
   with `RegisterSettle`: success → `SettleHubReplyTextLive` (by operation ID);
   failure or unavailable → `DeletePendingHubReplyText`. Audit
   `hub.reply.settled` or `hub.reply.discarded` only when a row changed.
4. Export `Prepare(replierDID, replyID, post ref, parent, body)` that returns a
   `commands.PrepareFunc`: lock the user, count replies in 24 hours (`>= 500`
   returns the `hub-post-limit-reached` problem), insert the pending row,
   audit `hub.reply.created`. T19 passes it in `Request.Prepare`.
5. Events in `eventkinds/registry.go`:
   - `hub-reply-edited`: update the copy (`UpdateHubPostReplyCopy`). Origin:
     reply author.
   - `hub-reply-removed`: `ClearHubPostReplyCopy`; apply the count rule.
     Origin: reply author. `ShareWatermark(HubReplyRemovedKind, HubReplyEditedKind)`.
   - `hub-post-removed`: `MarkHubRepliesPostRemoved` for the destination
     author. Origin: post owner.
6. Export `EnqueueEdited` and `EnqueueRemoved` for T19 (destination: the post
   owner from the reply text row; aggregate `hub_reply`, reply ID, version).
7. Job `reap-hub-pending-replies` in
   `backend/internal/workers/reap_hub_pending_replies.go`: every 10 minutes,
   batches of 100; delete expired pending rows and audit in the same
   transaction.
8. Job `clean-removed-hub-posts` in
   `backend/internal/workers/clean_removed_hub_posts.go`: every minute. For
   each removed post without `cleanup_done_at`: page reply authors 100 at a
   time; for each page, one transaction enqueues `hub-post-removed` to each
   author (aggregate `hub_post`, post ID, post `version`) and records the
   last DID in a cursor column or in the job state (add
   `cleanup_author_cursor uuid` to `hub_posts` in `00001_init.sql`). After the
   last page, delete the structure rows and set `cleanup_done_at`. T25 adds
   quote rows to the delete.
9. Register both jobs in `workers.go`.

## Tests

- `backend/internal/hubreplies/hubreplies_integration_test.go`: each refusal
  of PST-RPL-003 in order; blocked replier; parent checks; counts; settle on
  success and rejection; a replay does not run `Prepare` twice; the 500 cap.
- Event tests: edit updates the copy; an older edit after a removal is
  `superseded`; removal clears the copy and counts; post-removed marks only
  `pending` and `live` rows.
- `backend/internal/workers/reap_hub_pending_replies_integration_test.go`
  and `clean_removed_hub_posts_integration_test.go` (250 authors gives 3
  commits).

## Checks

- `cd backend && go test ./internal/hubreplies/... ./internal/workers/...`
- `make test-go GOTESTFLAGS='-p 2'`, `make test-go-static`, `make test-go-lint`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- The command, its hooks, three events, and two jobs are registered and
  tested.

## Carried over

- From T17: `SettleHubReplyTextLive`, `DeletePendingHubReplyText`,
  `MarkHubRepliesPostRemoved`, and the post owner side queries carry no audit
  CTE. The hook, handler, or job that calls them must write the audit event in
  the same transaction. `DeleteHubReplyTextsByIDs` writes its own events.
- From T17: `InsertHubPostReply` returns 0 rows on a redelivered command; skip
  `AdjustHubPostReplyCounts` then. `SetHubPostReplyState` and
  `ClearHubPostReplyCopy` return the old state for the count rule and
  `sql.ErrNoRows` (`pgx.ErrNoRows`) when nothing changed.
