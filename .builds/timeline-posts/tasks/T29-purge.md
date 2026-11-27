# T29 Workers: Purge posts after five years

## Requirements

PST-RET-001, PST-GEN-004

## Guides

`agent-guides/backend.md`, `agent-guides/database.md`, `agent-guides/go.md`,
`agent-guides/posts.md`

## Exemplars

- `backend/internal/workers/retain_org_applications.go` and its integration
  test
- `backend/internal/workers/workers.go`

## Steps

1. Queries in `backend/internal/db/queries/hub_posts_retention.sql`, each
   deleting at most `batch` rows older than `cutoff` and returning the count:
   `PurgeHubPosts` (cascades to revisions, structure rows, and quote rows
   under the post), `PurgeHubReplyTexts` (cascades to revisions),
   `PurgeHubPostReplies` (structure rows on younger posts, children before
   parents: delete only rows with no remaining child), `PurgeHubPostQuotes`.
2. Job `purge-hub-posts` in `backend/internal/workers/purge_hub_posts.go`:
   daily; cutoff `now() - interval '5 years'`; batch 1,000; loop each query
   until it deletes fewer than the batch; one transaction for each batch with
   an audit event `hub.posts.purged` that holds the table and the count.
3. Register the job in `workers.go`.
4. Add the 5-year rule to the retention list in `README.md` if one exists;
   otherwise leave it to T31.

## Tests

`backend/internal/workers/purge_hub_posts_integration_test.go`: rows older
than 5 years in each table go; younger rows stay; a parent with a younger
child stays until the child goes; 2,500 rows take 3 commits; audit per
commit.

## Checks

- `make sqlc`, `make sql-check`
- `cd backend && go test ./internal/workers/...`
- `make test-go GOTESTFLAGS='-p 2'`, `make test-go-static`, `make test-go-lint`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- The job is registered and tested.

## Carried over
