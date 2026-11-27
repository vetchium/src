# T23 Contracts: Add Hub quote posts

## Requirements

PST-QTE-001 to PST-QTE-012, PST-OWN-004, PST-RD-003

## Guides

`agent-guides/typespec.md`, `typespec/AGENTS.md`, `agent-guides/federation.md`,
`agent-guides/openings.md`, `agent-guides/posts.md`

## Exemplars

- `typespec/hub/posts/` (T10, T16), `typespec/federation/posts.tsp` (T16)
- `typespec/hub/openings/` (`PublicOpening`, Org domain and Opening number)

## Steps

1. In `typespec/hub/posts/quotes.tsp` (+ companions):
   - `QuoteTargetType`: `timeline_post`, `opening`.
   - `QuoteTarget` discriminated on `type`:
     `{ type: "timeline_post"; owner: ProfileAddress; post_id }` and
     `{ type: "opening"; org_domain; opening_number }` (reuse the Opening
     scalars).
   - `PostEmbed` discriminated on `state`:
     `{ state: "post"; post: EmbeddedPost }` (the `Post` fields without its
     own `embed`; a nested quote keeps only `quote_target`),
     `{ state: "opening"; opening: PublicOpening }` (or the existing summary
     type the Hub Opening list uses), `{ state: "unavailable" }`.
   - Add `quote_target?: QuoteTarget` and `embed?: PostEmbed` to `Post`. In
     responses the `owner` of a timeline target is the permanent handle.
   - `CreateQuoteRequest { target; body; reply_policy?; quote_policy? }` →
     `201` `Post`.
   - `ListQuotesRequest { owner; post_id; pagination_key?; limit? }` (default
     20, max 50) → `{ posts: Post[]; partial: boolean; next_pagination_key? }`.
   - `DetachQuoteRequest { post_id; quoter: ProfileAddress; quote_post_id }` → `204`.
   - Add `/create-quote`, `/list-quotes`, `/detach-quote` to
     `/api/hub/posts` with the BRIEF problem unions.
2. Mesh in `typespec/hub/posts/mesh.tsp`, relay and peer for each:
   - `read-quote-target { target_post_id; viewer }` → `MeshPost` or a
     refusal (`hub-post-not-found`, `hub-post-quote-refused`).
   - `read-embeds { items: { target_post_id; quote_post_id; quoter_hub_user_did }[] }`
     (1–50) → one result for each item: `post` or `unavailable`.
   - `list-quotes { post_id; pagination_key?; limit?; viewer }` →
     `{ quotes: { quoter_hub_user_did; quoter_handle; quoter_tenant_id; quote_post_id; created_at }[]; next_pagination_key? }`.
3. Federation in `typespec/federation/posts.tsp`: events
   `HubPostQuotedKind` (`hub-post-quoted`) payload
   `{ target_post_id; quote_post_id; quoter_handle; created_at }` and
   `HubPostUnquotedKind` (`hub-post-unquoted`) payload
   `{ target_post_id; quote_post_id }`.
4. Companions with validation; `typespec/package.json` exports.

## Tests

- `typespec/hub/posts/quotes_test.go`, `quotes.test.ts`: discriminator
  validation for both target types, body rules, limit range, item count
  1–50.
- `typespec/federation/posts_test.go`: the two event kinds.

## Checks

- In `typespec/`: `npm run check:contract-files`, `npm run compile`,
  `npm run typecheck`, `npm run test:ts`
- `make typespec-check`, `make test-go GOTESTFLAGS='-p 2'`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Contracts compile; quote kinds and payloads exist.

## Carried over
