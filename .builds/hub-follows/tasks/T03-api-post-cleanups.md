# T03 Hub API: Serve Allow replies, post tags, and the new quote rules

## Requirements

PST-POS-004, PST-POS-005, PST-POS-006, PST-POS-008, PST-POS-009,
PST-TAG-001 to PST-TAG-003, PST-RPL-003, PST-RPL-004, PST-QTE-001 to
PST-QTE-003, PST-QTE-005, PST-QTE-006, PST-QTE-009, PST-QTE-012,
PST-GEN-004

## Guides

`agent-guides/backend.md`, `agent-guides/go.md`, `agent-guides/database.md`,
`agent-guides/federation.md`, `agent-guides/posts.md`

## Exemplars

- `backend/handlers/orgs/openings/` handling of `org-opening-tag-unknown`
  (unknown tag problem with the OID list)
- `backend/handlers/hub/posts/posts.go` `SetPolicies`, `Create`, `Edit`
- `backend/handlers/hub/posts/quotes.go` `CreateQuote`, `DetachQuote`
- `backend/internal/hubreplies/hubreplies.go` `handleRegister`
- `backend/internal/hubquotes/hubquotes.go` `applyQuoted`, `applyUnquoted`
- `backend/internal/postread/` (post and embed reads)

## Steps

1. `backend/handlers/hub/posts/posts.go`: `Create` and `Edit` pass
   `allow_replies` (default true) and tags; before the write transaction,
   `UnknownOpeningTags` non-empty answers `hub-post-tag-unknown` with
   `unknown_tags`. Replace `SetPolicies` with `SetReplies`
   (`SetHubPostAllowReplies`, audit `hub.post.replies-set` with the new
   value). Register `/api/hub/posts/set-replies` and remove
   `/set-policies` in the hub-api route table
   (`git grep -n set-policies backend`).
2. `backend/handlers/hub/posts/quotes.go`: `CreateQuote` takes tags and
   `allow_replies`; after resolving a timeline target owner, a DID equal to
   the caller answers `hub-post-quote-own-post` before any mesh call. Delete
   `DetachQuote`, its route, and its audit event.
3. `backend/internal/postread/` and the mesh `read-quote-target`: refuse only
   on not live and on a block (no policy). Every post response sets
   `allow_replies` and `tags` (omit when `NULL`).
4. `backend/internal/hubquotes/hubquotes.go`: `applyQuoted` records nothing
   when the owner blocks the quoter (no detached row); `applyUnquoted`
   decrements only when a row was deleted.
5. `backend/internal/hubreplies/hubreplies.go` `handleRegister`: refuse with
   `hub-post-replies-closed` when `allow_replies` is false and the replier
   is not the post owner, for top-level replies and sub-replies.
6. `backend/handlers/hub/posts/replies.go`: the sub-reply path stores the
   parent author DID it already reads (PST-RPL-004) through the `Prepare`
   hook into `parent_author_hub_user_did`.
7. `blocked_by_owner` and `blocked_by_author`: set both to `false` in this
   task. T10 fills them from relationship copies. Add no TODO comment;
   append "From T03: fill blocked_by_owner and blocked_by_author" to T10
   `Carried over`.
8. Update `backend/handlers/hub/posts/*_test.go` and
   `backend/internal/hubreplies`, `hubquotes` integration tests that used
   policies, lock, or detach.

## Tests

- `backend/handlers/hub/posts/posts_test.go`: unknown tag answers 422 with
  the list; `set-replies` audits.
- `backend/handlers/hub/posts/quotes_test.go`: own target answers 422
  without a mesh call.
- `backend/internal/hubreplies/hubreplies_integration_test.go`: replies off
  refuses others and accepts the owner, top-level and sub-reply.
- `backend/internal/hubquotes/hubquotes_integration_test.go`: a quote from a
  blocked quoter records nothing; unquote decrements once.

## Checks

- `cd backend && go test ./handlers/hub/posts/... ./internal/hubreplies/...
  ./internal/hubquotes/... ./internal/postread/...`
- `make test-go`, `make test-go-static`, `make test-go-lint`
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- The API serves the T01 contract; no handler mentions policies, lock, or
  detach.

## Carried over
