# T08 Database: Add Hub relationship rows, copies, and the follow log

## Requirements

PST-REL-001, PST-REL-002, PST-REL-011, PST-FOL-004, PST-FOL-005,
PST-FOL-009, PST-FOL-010, PST-FOL-012, PST-GEN-004

## Guides

`agent-guides/database.md`, `backend/internal/db/AGENTS.md`,
`agent-guides/posts.md`

## Exemplars

- `db/migrations/00001_init.sql` `vetchium.hub_user_blocks` (being
  replaced) and `vetchium.hub_reply_texts` (operation ID column)
- `backend/internal/db/queries/hub_blocks.sql`
- `backend/internal/db/hub_blocks_integration_test.go`

## Steps

1. In `db/migrations/00001_init.sql`, replace `vetchium.hub_user_blocks` and
   its index with:
   ```sql
   CREATE TYPE vetchium.hub_follow_state AS ENUM
       ('none', 'pending', 'following', 'rejected');

   -- The authority for one pair (PST-REL-001): the remote user follows the
   -- local user, and the local user blocks the remote user.
   CREATE TABLE vetchium.hub_relationships (
       local_hub_user_did uuid NOT NULL
           REFERENCES vetchium.hub_users (hub_user_did) ON DELETE CASCADE,
       remote_hub_user_did uuid NOT NULL,
       remote_handle text NOT NULL,
       -- Routing hint only (federation.md); never authoritative.
       remote_tenant_id text NOT NULL,
       is_follower boolean NOT NULL DEFAULT false,
       followed_at timestamptz,
       -- The highest follow_seq applied from the remote follower.
       follower_seq bigint NOT NULL DEFAULT 0,
       is_blocked boolean NOT NULL DEFAULT false,
       blocked_at timestamptz,
       -- Versions hub-relationship-changed (PST-REL-006).
       version bigint NOT NULL DEFAULT 1,
       PRIMARY KEY (local_hub_user_did, remote_hub_user_did),
       CHECK (local_hub_user_did <> remote_hub_user_did),
       CHECK (is_follower = (followed_at IS NOT NULL)),
       CHECK (is_blocked = (blocked_at IS NOT NULL)),
       CHECK (NOT (is_follower AND is_blocked))
   );
   CREATE INDEX hub_relationships_blocks_idx ON vetchium.hub_relationships
       (local_hub_user_did, blocked_at DESC, remote_hub_user_did)
       WHERE is_blocked;
   CREATE INDEX hub_relationships_followers_idx ON vetchium.hub_relationships
       (local_hub_user_did, remote_hub_user_did) WHERE is_follower;

   -- The local user's own view of one pair, for screens (PST-REL-008).
   CREATE TABLE vetchium.hub_relationship_copies (
       local_hub_user_did uuid NOT NULL
           REFERENCES vetchium.hub_users (hub_user_did) ON DELETE CASCADE,
       remote_hub_user_did uuid NOT NULL,
       remote_handle text NOT NULL,
       remote_tenant_id text NOT NULL,
       follow_state vetchium.hub_follow_state NOT NULL DEFAULT 'none',
       follow_seq bigint NOT NULL DEFAULT 0,
       followed_at timestamptz,
       blocked_by_remote boolean NOT NULL DEFAULT false,
       PRIMARY KEY (local_hub_user_did, remote_hub_user_did),
       CHECK (local_hub_user_did <> remote_hub_user_did),
       CHECK ((follow_state IN ('pending', 'following'))
           = (followed_at IS NOT NULL))
   );
   CREATE INDEX hub_relationship_copies_following_idx
       ON vetchium.hub_relationship_copies
       (local_hub_user_did, followed_at DESC, remote_hub_user_did)
       WHERE follow_state IN ('pending', 'following');

   CREATE TABLE vetchium.hub_follow_log (
       hub_user_did uuid NOT NULL
           REFERENCES vetchium.hub_users (hub_user_did) ON DELETE CASCADE,
       followed_at timestamptz NOT NULL DEFAULT now()
   );
   CREATE INDEX hub_follow_log_user_idx ON vetchium.hub_follow_log
       (hub_user_did, followed_at);
   CREATE INDEX hub_follow_log_age_idx ON vetchium.hub_follow_log
       (followed_at);
   ```
   Update the `DROP` list at the end of the file. Add
   `follower_count integer NOT NULL DEFAULT 0 CHECK (follower_count >= 0)`
   to `vetchium.hub_users`. Check that the audit trigger loop and
   `make migration-check` cover the new tables.
2. Rewrite `backend/internal/db/queries/hub_blocks.sql` on
   `hub_relationships`, keeping the names and parameters of
   `InsertHubUserBlock` (upsert; sets `is_blocked`, `blocked_at`, clears
   `is_follower` and `followed_at`, adds 1 to `version`; returns whether it
   changed and whether `is_follower` was true), `DeleteHubUserBlock`
   (clears `is_blocked`, adds 1 to `version`), `ListHubUserBlocks` (keyset
   on `(blocked_at, remote_hub_user_did)` DESC), `HubUserBlockExists`,
   `HubUserBlockedAny`, `HubUserBlockPairs`, `GetHubUserBlockByHandle`. The
   mute queries stay on `hub_user_mutes`.
3. New `backend/internal/db/queries/hub_follows.sql`:
   - `LockHubRelationship` (upsert the row with handle and hint, then
     `SELECT ... FOR UPDATE`)
   - `SetHubFollower(local, remote, follower_seq)` and
     `ClearHubFollower(local, remote, follower_seq)`, each returning whether
     `is_follower` changed
   - `AddHubFollowerCount(did, delta)`
   - `GetHubFollowerCount(did)`
   - `LockHubRelationshipCopy` (upsert, then `FOR UPDATE`)
   - `SetHubRelationshipCopyFollow(local, remote, state, follow_seq,
     followed_at)`
   - `SettleHubFollow(local, remote, follow_seq, state)`: changes only a
     `pending` row with that `follow_seq`, returns rows changed
   - `ApplyHubRelationshipChanged(local, remote, handle, hint, blocked)`
     per PST-REL-006
   - `GetHubRelationshipCopy(local, remote)`, `HubBlockedByAny(local,
     remote DIDs)` (copies with `blocked_by_remote`)
   - `CountHubFollowing(local)` (`pending` and `following`)
   - `CountHubFollowLogSince(did, since)`, `InsertHubFollowLog(did)`
   - `ListHubFollowing(local, keyset, limit+1)`
   - `ListHubLatestLivePosts(author, 20)` (live posts and quotes newest
     first: `post_id`, `created_at`)
4. Run `make sqlc`. Keep `backend/` compiling by the smallest edit.

## Tests

- `backend/internal/db/hub_blocks_integration_test.go`: rewritten for the
  new table: block clears a follow, unblock keeps no follow, list order,
  `HubUserBlockedAny`, self-row `CHECK`.
- New `backend/internal/db/hub_follows_integration_test.go`:
  `SetHubFollower` with a lower seq changes nothing; `SettleHubFollow` skips
  a non-pending row and a different seq; `ApplyHubRelationshipChanged`
  sets `rejected` from `following` and `none` from `rejected`; counts;
  following list keyset with 3 rows and limit 2; cascade on user delete.

## Checks

- `make sqlc`, `make sql-check`, `make migration-check`
- `make test-go`, `make test-go-static`
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- `vetchium.hub_user_blocks` no longer exists; every block query reads
  `hub_relationships`.

## Carried over
