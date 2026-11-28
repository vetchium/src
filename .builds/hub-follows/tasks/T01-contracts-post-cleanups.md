# T01 Contracts: Replace post policies with Allow replies and add post tags

## Requirements

PST-POS-004, PST-POS-005, PST-POS-009, PST-TAG-001, PST-TAG-002,
PST-TAG-003, PST-QTE-001, PST-QTE-002, PST-QTE-003, PST-QTE-005,
PST-QTE-009, PST-RPL-003, PST-RPL-016, PST-THR-010, PST-REL-008

## Guides

`agent-guides/typespec.md`, `typespec/AGENTS.md`, `agent-guides/go.md`,
`agent-guides/typescript.md`, `agent-guides/posts.md`

## Exemplars

- `typespec/orgs/openings/*.tsp` and its `.go`/`.ts` companions: how
  Opening content carries `tags` as `Vetchium.OpeningTagOID[]` with
  `@maxItems` and the companion validators for repeats
- `typespec/common/opening_tags.tsp` (`OpeningTagOID`, `maxOpeningTags`)
- `typespec/problem/hub/posts.tsp` and companions (problem shape)

## Steps

1. `typespec/hub/posts/posts.tsp`:
   - Delete `ReplyPolicy`, `QuotePolicy`, and `SetPostPoliciesRequest`.
   - In `EmbeddedPost` delete `reply_policy`, `quote_policy`, `locked`; add
     `allow_replies: boolean;`, `/** Omitted when none (PST-TAG-001). */
     @maxItems(3) tags?: Vetchium.OpeningTagOID[];`, and
     `/** The owner blocked the viewer, from the viewer's relationship copy
     (PST-REL-008). */ blocked_by_owner: boolean;`.
   - `CreatePostRequest`: delete both policy fields; add
     `/** Default true. */ allow_replies?: boolean;` and
     `@maxItems(3) tags?: Vetchium.OpeningTagOID[];`.
   - `EditPostRequest`: add `@maxItems(3) tags?: Vetchium.OpeningTagOID[];`
     (absent or empty clears the tags).
   - Add `model SetPostRepliesRequest { post_id: PostID; allow_replies:
     boolean; }`; replace operation `setPolicies` (`/set-policies`) with
     `setReplies` (`/set-replies`), same responses.
   - Add `| Vetchium.Problem.HubPostTagUnknownErrorResponse` to `create` and
     `edit`.
2. `typespec/hub/posts/quotes.tsp`: in `CreateQuoteRequest` replace the two
   policy fields with `allow_replies?` and `tags?` as above; delete
   `DetachQuoteRequest` and operation `detachQuote` (`/detach-quote`); add
   `HubPostQuoteOwnPostErrorResponse` and `HubPostTagUnknownErrorResponse`
   to `createQuote`; change the `PostEmbedUnavailable` doc comment to
   "removed, missing, or not published".
3. `typespec/hub/posts/replies.tsp`: add `/** The reply's author blocked the
   viewer, from the viewer's relationship copy (PST-THR-010). */
   blocked_by_author: boolean;` to `Reply`; add
   `HubPostReplyRefusedErrorResponse` to `editReply`.
4. `typespec/hub/posts/mesh.tsp`: delete the policy and lock fields from
   every mesh model that carries them, add `allow_replies` and `tags?`, and
   delete any detach-related mesh model. Mesh responses do not carry
   `blocked_by_owner` or `blocked_by_author`; the viewer's hub-api adds them.
5. `typespec/problem/hub/posts.tsp`: add
   - `hub-post-tag-unknown` (`422`) with an extension `unknown_tags:
     Vetchium.OpeningTagOID[]` (copy the shape of `org-opening-tag-unknown`
     in `typespec/problem/orgs/`),
   - `hub-post-quote-own-post` (`422`), title "You can't quote your own
     post".
6. Update the Go and TypeScript companions of every changed file:
   `posts.go`/`posts.ts`, `quotes.go`/`quotes.ts`, `replies.go`/
   `replies.ts`, `mesh.go`/`mesh.ts`, `typespec/problem/hub/posts.go`/
   `posts.ts`. Validation: `tags` at most 3, each matching the
   `OpeningTagOID` pattern, no repeats; field names `tags` and
   `tags.<index>`. Export `MaxPostTags = 3` in Go and `maxPostTags = 3` in
   TypeScript.
7. Do not touch callers in `backend/` or `hub-ui/` beyond what is needed to
   compile: T03 and T05 own them. Where a caller no longer compiles, make the
   smallest edit that compiles (delete the policy field, pass
   `allow_replies: true`) and note it under `Carried over` of T03 or T05.

## Tests

- `typespec/hub/posts/posts_test.go` and `posts.test.ts`: tags valid with 0,
  1, 3; refused with 4, a repeat, a malformed OID; `allow_replies` optional
  on create.
- `quotes_test.go` and `quotes.test.ts`: the same tag cases on
  `CreateQuoteRequest`.

## Checks

- `make typespec-check`, `make test-go`, `make test-go-static`
- `make hub-ui-check`, `make playwright-check` (compile only)
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- No contract mentions `reply_policy`, `quote_policy`, `locked`, or detach.
- `make test` passes.

## Carried over
