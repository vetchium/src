# T27 Hub portal: Add quotes and embeds

## Requirements

PST-QTE-001, PST-QTE-008 to PST-QTE-012, PST-UI-003, Hub portal rows
`/u/:address/posts/:postId/quotes` and `/org/:domain/openings/:number`

## Guides

`agent-guides/ui.md`, `agent-guides/ux.md`, `agent-guides/typescript.md`,
`agent-guides/posts.md`

## Exemplars

- `hub-ui/src/features/posts/` (T14, T21)
- `hub-ui/src/pages/OrgOpeningPage.tsx`, `hub-ui/src/features/openings/OpeningCard.tsx`

## Steps

1. `hub-ui/src/features/posts/QuoteComposer.tsx`: a dialog with a preview of
   the target, the body, and policies. Open it from a Quote button on
   `PostCard` and from a Quote button on `OrgOpeningPage.tsx`. Hide the
   `PostCard` button when `quote_policy` is `nobody`. The owner may quote
   their own post.
2. `hub-ui/src/features/posts/PostEmbed.tsx`: a post embed (one level; a
   nested quote shows as a link), an Opening embed (reuse `OpeningCard`), and
   "This post is not available".
3. `hub-ui/src/pages/PostQuotesPage.tsx` at
   `u/:address/posts/:postId/quotes`: quote posts with Load more, the partial
   notice (PST-UI-003), and Detach with confirmation for the target owner.
4. The quote count on `PostCard` links to the quotes page.
5. Strings in `en.ts`, `de.ts`, `ta.ts`.

## Tests

UI specs come in T28.

## Checks

- `make hub-ui-check`, `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Quotes, embeds, and the quotes page work against the T25 API.

## Carried over
