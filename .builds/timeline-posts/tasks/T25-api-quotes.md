# T25 Hub API: Serve quotes and embeds

## Requirements

PST-QTE-001 to PST-QTE-012, PST-POS-003, PST-BLK-002, PST-BLK-005, PST-RD-001
to PST-RD-004, PST-GEN-004

## Guides

`agent-guides/backend.md`, `agent-guides/go.md`, `agent-guides/database.md`,
`agent-guides/federation.md`, `agent-guides/openings.md`, `agent-guides/posts.md`

## Exemplars

- `backend/handlers/hub/posts/` (T12, T19), `backend/internal/postsclient`
- `backend/internal/publicopeningclient/` (read a `PublicOpening`)
- `backend/internal/hubreplies/` (T18 event receivers and `ShareWatermark`)
- `backend/internal/fanout` (T03)

## Steps

1. `CreateQuote` in `backend/handlers/hub/posts/quotes.go`:
   1. Timeline target: resolve the owner; read with
      `/mesh/posts/read-quote-target` (local query when local). Map
      refusals; transport failure → `hub-post-unavailable`.
   2. Opening target: read the `PublicOpening` with `publicopeningclient`.
      Not found or not `published` → `hub-opening-not-found`. Failure →
      `hub-post-unavailable`.
   3. One transaction: lock the user, apply the 100-post cap, insert the
      quote post, audit `hub.post.quoted`, and for a timeline target enqueue
      `hub-post-quoted` to the target owner (aggregate `hub_post`, the quote
      post ID, its `version`).
2. Package `backend/internal/hubquotes` with receivers registered in
   `eventkinds/registry.go`, origin the quoter:
   `hub-post-quoted` per PST-QTE-005 (check policy and
   `HubUserBlockExists(owner, quoter)`); `hub-post-unquoted` per
   PST-QTE-006. `ShareWatermark(HubPostUnquotedKind, HubPostQuotedKind)`.
3. In `Remove` (T12): when the post is a timeline quote, enqueue
   `hub-post-unquoted` in the removal transaction. In the T18
   `clean-removed-hub-posts` job, also call `DeleteHubPostQuotesByPost`.
4. `DetachQuote`: own post; resolve `quoter`; `DetachHubPostQuote`; reduce
   the count when 1 row changed; audit `hub.post.quote-detached`; `204`.
   Not found → `hub-post-not-found`.
5. Embeds: after any read that returns posts (`List`, `Get`, `ListQuotes`),
   collect timeline quote targets, group by target owner tenant, and call
   `/mesh/posts/read-embeds` with `fanout.Do`. Opening targets use
   `publicopeningclient`. A failed region gives `unavailable` embeds. An
   embedded post that is itself a quote keeps only `quote_target`.
6. `ListQuotes`: read `list-quotes` from the target owner's tenant, filter
   out muted quoters, group by quoter tenant, read the quote posts with
   `/mesh/posts/get-many` through `fanout.Do` and `Regroup` for
   `not-homed`. A failed region sets `partial: true` and its items are left
   out. Keep the target owner's pagination key as the next key.
7. Mesh relay and peer handlers for `read-quote-target`, `read-embeds`, and
   `list-quotes` with viewer verification.
8. Register routes.

## Tests

- `backend/internal/hubquotes/hubquotes_integration_test.go`: quoted inserts
  and counts; refused policy or block inserts detached without a count;
  unquoted after detach keeps the count; a late quoted after unquoted is
  `superseded`.
- Handler unit tests for embed grouping in
  `backend/handlers/hub/posts/quotes_test.go`.

## Checks

- `cd backend && go test ./handlers/... ./internal/hubquotes/...`
- `make test-go GOTESTFLAGS='-p 2'`, `make test-go-static`, `make test-go-lint`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Every T23 operation is routed; embeds appear on every post read.

## Carried over

From T12 (orchestrator): the T12 `get-many` relay fails the whole call when one tenant fails. `list-quotes` and `read-embeds` must keep partial results. Call one tenant per `fanout.Do` read, or make the relay return a result for each tenant, so one failed region sets `partial` or gives `unavailable` embeds only for that region.
