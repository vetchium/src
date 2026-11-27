# T11 Database: Add Hub timeline posts

## Requirements

PST-ID-003, PST-GEN-003, PST-GEN-005, PST-POS-001, PST-POS-003, PST-POS-004 to
PST-POS-008, PST-POS-011, PST-POS-012

## Guides

`agent-guides/database.md`, `backend/internal/db/AGENTS.md`,
`agent-guides/hub-subscriptions.md` ("Plan-gated features"),
`agent-guides/posts.md`

## Exemplars

- `backend/internal/db/queries/hub_profile_private.sql:235`
  (`hub_plan_oid = ANY(...)` in a write)
- `backend/internal/db/queries/hub_chat_requests.sql`
- `db/migrations/00001_init.sql` enums and `CHECK` style

## Steps

1. In `db/migrations/00001_init.sql` add enums `vetchium.hub_post_kind`
   (`post`, `quote`), `vetchium.hub_post_policy` (`everyone`, `nobody`),
   `vetchium.hub_post_state` (`live`, `removed`, `taken_down`).
2. Add `vetchium.hub_posts`:
   `post_id text COLLATE "C" PRIMARY KEY CHECK (post_id ~ '^[0-9a-v]{20}[0-9a-z]{20}$')`,
   `author_hub_user_did uuid NOT NULL REFERENCES vetchium.hub_users ON DELETE CASCADE`,
   `kind hub_post_kind NOT NULL`, `body text` (`CHECK` live rows have a
   body of 1–512 code points with no surrounding whitespace; removed rows have
   `NULL`), `reply_policy`, `quote_policy` (default `everyone`),
   `locked_at timestamptz`, `reply_count int NOT NULL DEFAULT 0 CHECK (>= 0)`,
   `quote_count` the same, `state hub_post_state NOT NULL DEFAULT 'live'`,
   `revision int NOT NULL DEFAULT 1`, `version bigint NOT NULL DEFAULT 1`,
   `created_at`, `edited_at`, `removed_at`,
   `cleanup_done_at timestamptz` (T18 uses it). Index
   `(author_hub_user_did, created_at DESC, post_id DESC) WHERE state = 'live'`
   and `(author_hub_user_did, created_at)` for the daily cap.
3. Add `vetchium.hub_post_revisions (post_id REFERENCES hub_posts ON DELETE CASCADE, revision int, body text NOT NULL, created_at, PRIMARY KEY (post_id, revision))`.
4. Queries in `backend/internal/db/queries/hub_posts.sql`:
   - `LockHubUserForPosting` (`SELECT ... FOR UPDATE` on `hub_users`, returns
     `hub_plan_oid`).
   - `CountHubPostsSince` (author, since; any state).
   - `InsertHubPost` with `kind = 'post'` gated by
     `hub_plan_oid = ANY(entitled_plan_oids)` through a join on `hub_users`;
     zero rows means the plan refused.
   - `EditHubPost`: one statement that copies the old body into
     `hub_post_revisions` (CTE) and updates body, `revision + 1`,
     `version + 1`, `edited_at`, only when state is `live`, `revision` equals
     the request, `created_at > now() - interval '30 minutes'`, and for
     `kind = 'post'` the plan gate holds. Return enough columns for the
     handler to tell which condition failed (or a follow-up read query).
   - `RemoveHubPost`: sets `removed`, `body = NULL`, `removed_at`,
     `version + 1`; deletes revisions in the same statement (CTE).
   - `SetHubPostPolicies`: policies and `locked_at` (keep the existing
     `locked_at` when it stays locked), `version + 1`.
   - `ListHubPostsByAuthor` (keyset DESC, `limit + 1`, live only).
   - `GetHubPostsByIDs` (author DID and an array of IDs, live only).
5. `make sqlc`.

## Tests

`backend/internal/db/hub_posts_integration_test.go`:

- Plan gate: free tier inserts 0 rows; Silver inserts.
- Edit: success adds a revision row; stale revision, closed window (set
  `created_at` back 31 minutes), removed post, and lost plan each update 0
  rows.
- Remove clears body and revisions.
- List keyset with 3 rows, limit 2; removed rows left out.
- `CHECK` refuses a 513-code-point body and a bad ID.

## Checks

- `make sqlc`, `make sql-check`, `make migration-check`
- `make test-go GOTESTFLAGS='-p 2'`, `make test-go-static`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Tables, constraints, and queries exist with integration tests.

## Carried over
