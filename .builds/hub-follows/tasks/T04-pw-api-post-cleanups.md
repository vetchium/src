# T04 Playwright: Test Allow replies, post tags, and quote rules

## Requirements

PST-POS-004, PST-POS-005, PST-POS-006, PST-TAG-002, PST-TAG-003,
PST-RPL-003, PST-QTE-002, PST-QTE-003, PST-QTE-005, PST-QTE-006

## Guides

`agent-guides/playwright.md`, `playwright/AGENTS.md`,
`agent-guides/typescript.md`, `agent-guides/posts.md`

## Exemplars

- `playwright/api/hub-posts.spec.ts`, `playwright/api/hub-post-replies.spec.ts`
  (same-region and cross-region scenarios), `playwright/api/hub-post-quotes.spec.ts`
- `playwright/lib/hub-posts.ts` (`HubPostsAPI`, `HubQuotesAPI`, `Cast`)

## Steps

1. `playwright/lib/hub-posts.ts`: replace `setPolicies` with `setReplies`
   (`/api/hub/posts/set-replies`); delete `detach`; update `PostOperation`
   and `QuoteOperation` unions and any helper that sent policies.
2. `playwright/api/hub-posts.spec.ts`: delete policy and lock tests. Add:
   create with `allow_replies` omitted reads `true`; create with 3 tags
   echoes them; 4 tags, a repeat, and a malformed OID answer
   `validation-failed` naming `tags` / `tags.<index>`; an unknown OID
   answers `hub-post-tag-unknown` with `unknown_tags`; edit inside the
   window changes words and tags together; `set-replies` by a non-owner
   answers `hub-post-not-found`.
3. `playwright/api/hub-post-replies.spec.ts`: for both scenarios, replies off
   refuses another user's top-level reply and sub-reply with
   `hub-post-replies-closed` and accepts the owner's; existing replies stay
   listed.
4. `playwright/api/hub-post-quotes.spec.ts`: delete detach tests; quoting a
   post with replies off succeeds; quoting the caller's own post or own
   quote answers `hub-post-quote-own-post`; a quote of another user's quote
   succeeds; a blocked quoter answers `hub-post-quote-refused` (both
   scenarios); removing a quote reduces the quote count once.

## Tests

The steps above. Each requirement ID appears in a test title or a comment
beside its assertion.

## Checks

- `make playwright-check`
- `make test-environment`, then in `playwright/` `npx playwright test
  api/hub-posts.spec.ts api/hub-post-replies.spec.ts
  api/hub-post-quotes.spec.ts`
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- Contract coverage lists `set-replies` and no `set-policies` or
  `detach-quote`.

## Carried over
