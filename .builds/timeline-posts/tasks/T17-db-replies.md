# T17 Database: Add Hub post replies

## Requirements

PST-ID-003, PST-OWN-001, PST-OWN-002, PST-RPL-001, PST-RPL-002, PST-RPL-006 to
PST-RPL-014, PST-THR-002, PST-TAB-001

## Guides

`agent-guides/database.md`, `backend/internal/db/AGENTS.md`,
`agent-guides/posts.md`

## Exemplars

- `db/migrations/00001_init.sql` (`vetchium.hub_posts` from T11,
  `vetchium.federation_operations`)
- `backend/internal/db/queries/hub_posts.sql` (T11)

## Steps

1. Enums: `vetchium.hub_reply_text_state` (`pending`, `live`, `removed`,
   `taken_down`, `post_removed`); `vetchium.hub_post_reply_state` (`live`,
   `hidden_by_owner`, `author_removed`).
2. `vetchium.hub_reply_texts` (reply author's tenant, authority):
   `reply_id` PK with the ID `CHECK`, `author_hub_user_did` FK to
   `hub_users` `ON DELETE CASCADE`, `post_owner_hub_user_did uuid NOT NULL`,
   `post_owner_handle text NOT NULL`, `post_owner_tenant_id text NOT NULL`
   (routing hint), `post_id`, `parent_reply_id`, `operation_id uuid`
   (non-null only while `pending`), `body` (1–512 code points unless
   `removed` or `taken_down`), `state`, `revision`, `version`, `created_at`,
   `edited_at`, `removed_at`. Indexes: Replies tab
   `(author_hub_user_did, created_at DESC, reply_id DESC) WHERE state IN ('live','post_removed')`;
   cap `(author_hub_user_did, created_at)`; `(post_owner_hub_user_did, post_id)`;
   `(operation_id) WHERE operation_id IS NOT NULL`.
3. `vetchium.hub_reply_revisions (reply_id REFERENCES hub_reply_texts ON DELETE CASCADE, revision, body, created_at, PRIMARY KEY (reply_id, revision))`.
4. `vetchium.hub_post_replies` (post owner's tenant): `post_id` FK to
   `hub_posts` `ON DELETE CASCADE`, `reply_id`, `parent_reply_id`,
   `author_hub_user_did`, `author_handle`, `author_tenant_id`, `body`
   (the reply copy; `NULL` when `author_removed`), `revision`, `state`,
   `child_count int NOT NULL DEFAULT 0 CHECK (>= 0)`,
   `child_row_count` the same, `created_at`. `PRIMARY KEY (post_id, reply_id)`;
   `FOREIGN KEY (post_id, parent_reply_id) REFERENCES hub_post_replies (post_id, reply_id)`.
   Indexes: top-level `(post_id, created_at, reply_id) WHERE parent_reply_id IS NULL`;
   children `(post_id, parent_reply_id, created_at, reply_id) WHERE parent_reply_id IS NOT NULL`;
   `(post_id, author_hub_user_did)` for cleanup.
5. Queries in `backend/internal/db/queries/hub_replies.sql`:
   - Replier side: `CountHubRepliesSince`, `InsertPendingHubReplyText`,
     `SettleHubReplyTextLive` (only `pending`, clears `operation_id`),
     `DeletePendingHubReplyText` (by operation ID, only `pending`),
     `EditHubReplyText` (revision copy, window, revision match, live only),
     `RemoveHubReplyText` (clears body, deletes revisions, `version + 1`),
     `MarkHubRepliesPostRemoved` (author, post owner, post; only `pending`
     and `live`; clears `operation_id`), `ListHubReplyTextsByAuthor`
     (keyset), `ListExpiredPendingHubReplyTexts` (join
     `federation_operations` on `operation_id` where `expires_at < now()`,
     limit), `DeleteHubReplyTextsByIDs`.
   - Post owner side: `GetHubPostForReply` (`FOR UPDATE`; state,
     `locked_at`, `reply_policy`, author), `GetHubPostReplyForUpdate`,
     `InsertHubPostReply`, `AdjustHubPostReplyCounts` (post reply count and
     parent counts by deltas), `SetHubPostReplyState` (returns old and new
     state for the count rule), `UpdateHubPostReplyCopy` (body, revision;
     only `live` or `hidden_by_owner`), `ClearHubPostReplyCopy`
     (`author_removed`, body `NULL`), `ListHubPostReplies` (top-level or
     one parent, keyset ASC, `limit + 1`), `GetHubPostReply`,
     `ListRemovedHubPostsForCleanup` (state not `live`,
     `cleanup_done_at IS NULL`, limit), `ListHubPostReplyAuthors` (distinct
     author DID, handle, tenant; keyset on DID, limit 100),
     `DeleteHubPostRepliesByPost`, `MarkHubPostCleanupDone`.
6. `make sqlc`.

## Tests

`backend/internal/db/hub_replies_integration_test.go`:

- Pending → live settle; settle refuses a non-pending row.
- Delete pending by operation ID.
- Parent FK refuses a parent in another post.
- Thread order and keyset for top-level and children.
- Copy update refuses an `author_removed` row.
- `MarkHubRepliesPostRemoved` changes only `pending` and `live`.
- Cleanup author keyset in pages of 100.

## Checks

- `make sqlc`, `make sql-check`, `make migration-check`
- `make test-go GOTESTFLAGS='-p 2'`, `make test-go-static`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Tables, constraints, and queries exist with integration tests.

## Carried over
