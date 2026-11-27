# T05 Database: Add Hub user blocks and mutes

## Requirements

PST-BLK-001, PST-BLK-006, PST-BLK-007, PST-GEN-004

## Guides

`agent-guides/database.md`, `backend/internal/db/AGENTS.md`,
`agent-guides/posts.md`

## Exemplars

- `db/migrations/00001_init.sql`: `vetchium.hub_websites` (owned rows with
  `ON DELETE CASCADE`), the audit trigger loop at the end of the file
- `backend/internal/db/queries/hub_chat_requests.sql` (keyset lists)
- `backend/internal/db/website_integration_test.go`

## Steps

1. In `db/migrations/00001_init.sql`, above the audit trigger loop, add:
   ```sql
   CREATE TABLE vetchium.hub_user_blocks (
       blocker_hub_user_did uuid NOT NULL
           REFERENCES vetchium.hub_users (hub_user_did) ON DELETE CASCADE,
       blocked_hub_user_did uuid NOT NULL,
       blocked_handle text NOT NULL,
       -- Routing hint only (federation.md); never authoritative.
       blocked_tenant_id text NOT NULL,
       created_at timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY (blocker_hub_user_did, blocked_hub_user_did),
       CHECK (blocker_hub_user_did <> blocked_hub_user_did)
   );
   CREATE INDEX hub_user_blocks_list_idx ON vetchium.hub_user_blocks
       (blocker_hub_user_did, created_at DESC, blocked_hub_user_did);
   ```
   Add `vetchium.hub_user_mutes` with the same shape (`muter_hub_user_did`,
   `muted_hub_user_did`, `muted_handle`, `muted_tenant_id`).
2. Create `backend/internal/db/queries/hub_blocks.sql` with:
   `InsertHubUserBlock` (`ON CONFLICT DO NOTHING`, returns the row count),
   `DeleteHubUserBlock`, `ListHubUserBlocks` (keyset on
   `(created_at, blocked_hub_user_did)` DESC, `limit + 1`),
   `HubUserBlockExists` (blocker, blocked),
   `HubUserBlockedAny` (blocker, array of DIDs, returns the blocked DIDs).
   The same five for mutes (`...Mute...`), with `HubUserMutedAny` used to
   filter lists later.
3. Run `make sqlc`.
4. Check that the audit trigger covers both tables (`make migration-check`).

## Tests

`backend/internal/db/hub_blocks_integration_test.go`:

- Insert twice: second returns 0 rows.
- Self-block violates the `CHECK`.
- List order and keyset continuation with 3 rows and limit 2.
- `HubUserBlockedAny` and `HubUserMutedAny` return only matching DIDs.
- Deleting the Hub user cascades.

## Checks

- `make sqlc`, `make sql-check`, `make migration-check`
- `make test-go GOTESTFLAGS='-p 2'`, `make test-go-static`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Both tables, indexes, and queries exist with integration tests.

## Carried over
