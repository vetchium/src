# T15 Database: Add Timeline entries and post fan-out columns

## Requirements

PST-TL-001 to PST-TL-003, PST-TL-005, PST-TL-007, PST-TL-008

## Guides

`agent-guides/database.md`, `backend/internal/db/AGENTS.md`,
`agent-guides/posts.md`

## Exemplars

- `db/migrations/00001_init.sql` `vetchium.hub_posts` cleanup columns
  (`cleanup_done_at`, `cleanup_author_cursor`, `hub_posts_cleanup_idx`)
- `backend/internal/db/queries/hub_posts.sql`

## Steps

1. In `db/migrations/00001_init.sql`, `vetchium.hub_posts`: add
   `fanout_done_at timestamptz` and `fanout_cursor uuid` with a comment
   citing PST-TL-003, and
   `CREATE INDEX hub_posts_fanout_idx ON vetchium.hub_posts (created_at,
   post_id) WHERE fanout_done_at IS NULL;`. A new row has
   `fanout_done_at` `NULL`.
2. Add:
   ```sql
   CREATE TABLE vetchium.hub_timeline_entries (
       reader_hub_user_did uuid NOT NULL
           REFERENCES vetchium.hub_users (hub_user_did) ON DELETE CASCADE,
       author_hub_user_did uuid NOT NULL,
       author_handle text NOT NULL,
       -- Routing hint only (federation.md); never authoritative.
       author_tenant_id text NOT NULL,
       post_id text COLLATE "C" NOT NULL
           CHECK (post_id ~ '^[0-9a-v]{20}[0-9a-z]{20}$'),
       post_created_at timestamptz NOT NULL,
       PRIMARY KEY (reader_hub_user_did, post_id)
   );
   CREATE INDEX hub_timeline_entries_list_idx
       ON vetchium.hub_timeline_entries
       (reader_hub_user_did, post_created_at DESC, post_id DESC);
   CREATE INDEX hub_timeline_entries_author_idx
       ON vetchium.hub_timeline_entries
       (reader_hub_user_did, author_hub_user_did);
   CREATE INDEX hub_timeline_entries_age_idx
       ON vetchium.hub_timeline_entries (post_created_at);
   ```
   Update the `DROP` list.
3. New `backend/internal/db/queries/hub_timeline.sql`:
   `InsertHubTimelineEntry` (`ON CONFLICT DO NOTHING`),
   `InsertHubTimelineEntries` (arrays, for the follow backfill),
   `TrimHubTimeline(reader, keep 1000)` (deletes entries beyond the newest
   1,000), `DeleteHubTimelineEntriesByAuthor(reader, author)`,
   `ListHubTimelineEntries` (keyset `(post_created_at, post_id)` DESC,
   `limit + 1`), `DeleteOldHubTimelineEntries(before, limit 1000)`,
   `DeleteOldHubFollowLog(before, limit 1000)`,
   `ListHubPostsToFanOut(limit)` (posts with `fanout_done_at IS NULL`,
   oldest first, `FOR UPDATE SKIP LOCKED`), `ListHubFollowersAfter(local,
   cursor, 1000)` (`is_follower` rows by remote DID),
   `SetHubPostFanoutCursor`, `MarkHubPostFanoutDone`.
4. Run `make sqlc`.

## Tests

`backend/internal/db/hub_timeline_integration_test.go`: insert twice is
one row; trim keeps the newest 1,000 of 1,003; delete by author; keyset
order with equal `post_created_at`; old-row deletes stop at the limit;
followers page by cursor.

## Checks

- `make sqlc`, `make sql-check`, `make migration-check`
- `make test-go`, `make test-go-static`
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- The table, columns, indexes, and queries exist with integration tests.

## Carried over
