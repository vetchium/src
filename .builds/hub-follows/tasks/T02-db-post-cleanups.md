# T02 Database: Replace post policies, add post tags, and drop quote detach

## Requirements

PST-POS-004, PST-POS-005, PST-POS-006, PST-TAG-003, PST-TAG-004,
PST-QTE-005, PST-QTE-006, PST-QTE-012, PST-RPL-003, PST-RPL-004

## Guides

`agent-guides/database.md`, `backend/internal/db/AGENTS.md`,
`agent-guides/posts.md`

## Exemplars

- `db/migrations/00001_init.sql`: `org_opening_contents.tag_oids` checks and
  the `check_opening_tag_oids` trigger (OPN-TAG-009)
- `backend/internal/db/queries/hub_posts.sql` (`InsertHubPost`,
  `EditHubPost`, `SetHubPostPolicies`)
- `backend/internal/db/hub_posts_integration_test.go`

## Steps

1. In `db/migrations/00001_init.sql`, `vetchium.hub_posts`: delete
   `reply_policy`, `quote_policy`, `locked_at`; add
   `allow_replies boolean NOT NULL DEFAULT true` and `tag_oids text[]` with
   the same `CHECK`s as `org_opening_contents.tag_oids` but a maximum of 3
   (`cardinality(tag_oids) BETWEEN 1 AND 3`, no nulls, no repeats, format).
   Add `CREATE TRIGGER hub_posts_check_tag_oids BEFORE INSERT OR UPDATE OF
   tag_oids ON vetchium.hub_posts FOR EACH ROW EXECUTE FUNCTION
   vetchium.check_opening_tag_oids();` (the function must be defined above
   the table; move nothing else).
2. Delete `CREATE TYPE vetchium.hub_post_policy` and its `DROP TYPE` line.
3. `vetchium.hub_post_revisions`: add `tag_oids text[]` (copy of the old
   tags, no trigger).
4. `vetchium.hub_post_quotes`: delete `detached_at` and its comment; make
   `hub_post_quotes_list_idx` a full index (no `WHERE`).
5. `vetchium.hub_reply_texts`: add `parent_author_hub_user_did uuid` with a
   `CHECK ((parent_reply_id IS NULL) = (parent_author_hub_user_did IS
   NULL))`.
6. Queries:
   - `hub_posts.sql`: `InsertHubPost` takes `allow_replies` and `tag_oids`
     and refuses an unknown tag before inserting: add query
     `UnknownOpeningTags(tag_oids text[]) :many` returning each OID not in
     `vetchium.opening_tags` once, in input order. `EditHubPost` takes
     `tag_oids` and copies the old `tag_oids` into the revision row. Rename
     `SetHubPostPolicies` to `SetHubPostAllowReplies` (sets `allow_replies`,
     adds 1 to `version`, returns the row). Every `SELECT` of a post returns
     `allow_replies` and `tag_oids` and no policy column.
   - `hub_quotes.sql`: `InsertHubQuotePost` takes `allow_replies` and
     `tag_oids`; delete `DetachHubPostQuote`; drop `detached_at` from
     `InsertHubPostQuote`, `DeleteHubPostQuote`, `ListHubPostQuotes`,
     `GetHubPostQuote`, and `DecrementHubPostQuoteCount` callers (delete and
     decrement when a row was deleted).
   - `hub_replies.sql`: the reply refusal reads `allow_replies` and the post
     owner DID instead of policy and lock; the pending reply insert takes
     `parent_author_hub_user_did`; add `GetHubReplyTextForEdit` columns
     `post_owner_hub_user_did`, `parent_author_hub_user_did` if missing.
7. Run `make sqlc`. Fix compile errors in `backend/` by the smallest edit;
   T03 owns behavior. Note each such edit under T03 `Carried over`.

## Tests

`backend/internal/db/hub_posts_integration_test.go`:

- Insert with 0 and 3 tags; 4 tags, a repeat, and an unknown OID violate
  the checks or trigger; `UnknownOpeningTags` lists unknown OIDs once.
- Edit keeps the old body and tags in the revision.
- `SetHubPostAllowReplies` flips the flag and adds 1 to `version`.

`backend/internal/db/hub_quotes_integration_test.go`: quote rows have no
detach; list returns every row.

## Checks

- `make sqlc`, `make sql-check`, `make migration-check`
- `make test-go`, `make test-go-static`
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- No column, type, or query refers to post policies, lock, or detach.

## Carried over
