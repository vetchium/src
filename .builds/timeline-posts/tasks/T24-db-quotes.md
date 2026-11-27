# T24 Database: Add Hub quote posts

## Requirements

PST-QTE-001, PST-QTE-002, PST-QTE-004 to PST-QTE-008, PST-QTE-012

## Guides

`agent-guides/database.md`, `backend/internal/db/AGENTS.md`,
`agent-guides/posts.md`

## Exemplars

- `vetchium.hub_posts` and `backend/internal/db/queries/hub_posts.sql` (T11)

## Steps

1. In `db/migrations/00001_init.sql`:
   - Enum `vetchium.hub_quote_target_type` (`timeline_post`, `opening`).
   - Add to `vetchium.hub_posts`: `quote_target_type`,
     `quote_owner_principal_type` (the existing principal type enum, or text
     with a `CHECK` for `hub_user` and `org`), `quote_owner_did uuid`,
     `quote_owner_address text` (handle or Org domain), `quote_owner_tenant_id text`
     (routing hint), `quote_target_id text` (post ID or Opening number). A
     `CHECK`: all six are set when `kind = 'quote'` and all are `NULL` when
     `kind = 'post'`.
   - `vetchium.hub_post_quotes`: `target_post_id` FK to `hub_posts`
     `ON DELETE CASCADE`, `quoter_hub_user_did uuid`, `quoter_handle text`,
     `quoter_tenant_id text`, `quote_post_id text COLLATE "C"`,
     `created_at`, `detached_at`, `PRIMARY KEY (target_post_id, quote_post_id)`.
     Index `(target_post_id, created_at DESC, quote_post_id DESC) WHERE detached_at IS NULL`.
2. Queries in `backend/internal/db/queries/hub_quotes.sql`:
   `InsertHubQuotePost` (no plan gate), `InsertHubPostQuote` (with or
   without `detached_at`, `ON CONFLICT DO NOTHING`),
   `IncrementHubPostQuoteCount`, `DeleteHubPostQuote` (returns
   `detached_at`), `DecrementHubPostQuoteCount`, `DetachHubPostQuote` (only
   where `detached_at IS NULL`, returns the row count),
   `ListHubPostQuotes` (keyset DESC, `limit + 1`), `GetHubPostQuote`,
   `DeleteHubPostQuotesByPost`, `GetHubPostForQuote` (state, policy, author).
3. Change `ListHubPostsByAuthor` and `GetHubPostsByIDs` to return the quote
   columns.
4. `make sqlc`.

## Tests

`backend/internal/db/hub_quotes_integration_test.go`: the `CHECK` for both
kinds; insert and double insert; detach once only; delete returns
`detached_at`; list keyset leaves out detached rows.

## Checks

- `make sqlc`, `make sql-check`, `make migration-check`
- `make test-go GOTESTFLAGS='-p 2'`, `make test-go-static`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Columns, table, and queries exist with integration tests.

## Carried over
