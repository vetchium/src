# T05 Hub portal: Replace the policy controls with Allow replies and tags

## Requirements

PST-UI-005, PST-UI-006, PST-UI-009, PST-UI-010, PST-TAG-005, PST-POS-008,
PST-QTE-001, PST-QTE-002

## Guides

`agent-guides/ui.md`, `agent-guides/ux.md`, `hub-ui/AGENTS.md`,
`agent-guides/typescript.md`, `agent-guides/writing.md`,
`agent-guides/posts.md`

## Exemplars

- `portal-ui/src/opening-tags/OpeningTagSelect.tsx`, `catalog.ts` and their
  use in `hub-ui/src/features/openings/`
- `hub-ui/src/pages/PostPage.tsx` (`PolicyForm`, `OwnerControls`,
  `EditForm`), `hub-ui/src/features/posts/PostComposer.tsx`,
  `QuoteComposer.tsx`, `PostCard.tsx`, `PostEmbed.tsx`, `Thread.tsx`,
  `hub-ui/src/pages/PostQuotesPage.tsx`

## Steps

1. `portal-ui/src/opening-tags/OpeningTagSelect.tsx`: add an optional
   `maxCount` prop, default `maxOpeningTags`. Run `make portal-ui-check`.
2. Add `hub-ui/src/features/posts/PostTags.tsx`: shows the tags of a post as
   Ant `Tag`s with name and icon by OPN-TAG-004 and OPN-TAG-005 (reuse the
   catalog hook used by `features/openings`). Not links.
3. `PostComposer.tsx`: delete `PolicySelect`; add a tag picker
   (`OpeningTagSelect` with `maxCount={maxPostTags}`, label "Tags",
   "Optional") and a `Switch` "Allow replies" (on). Send `tags` and
   `allow_replies`. Reset both after success.
4. `QuoteComposer.tsx`: the same fields as the composer.
5. `PostPage.tsx`: delete `PolicyForm`. In `OwnerControls`, add an
   "Allow replies" `Switch` that saves at once through a new
   `useSetPostRepliesMutation` (`features/posts/queries.ts`) and shows
   "Replies are on" / "Replies are off" with `message.success`. `EditForm`
   edits words and tags together.
6. `PostCard.tsx`: show `PostTags`; delete the locked `Tag`; show
   `QuoteButton` only when the viewer is not the owner and
   `blocked_by_owner` is false (pass the viewer handle from
   `useMyInfoQuery`); a `quote_count` of 0 is plain secondary text.
7. `Thread.tsx`: `canReply` is `post.allow_replies || viewer is owner`. In
   place of the composer, everyone but the owner sees "The author turned
   off replies" as secondary text.
8. `PostQuotesPage.tsx`: delete Detach, its mutation in `queries.ts`, and its
   strings.
9. Locale files `hub-ui/src/i18n/locales/en.ts`, `de.ts`, `ta.ts`: delete
   every `posts.policy.*`, `posts.replyPolicy`, `posts.quotePolicy`,
   `posts.locked`, detach string; add `posts.tags.label`,
   `posts.tags.optional`, `posts.allowReplies.label`,
   `posts.allowReplies.on`, `posts.allowReplies.off`,
   `posts.repliesClosed`. German and Tamil get real translations.
10. Look at each changed screen on the dev stack in light and dark, at
    390px, and in German (`ux.md`, "Check before done").

## Tests

T06 covers the screens. Update existing `playwright/ui/hub-posts.spec.ts`,
`hub-post-quotes.spec.ts`, and `hub-post-replies.spec.ts` only where they
broke from removed controls, so `make test` passes.

## Checks

- `make portal-ui-check`, `make hub-ui-check`, `make admin-ui-check`,
  `make orgs-ui-check`
- `make fmt`, `git diff --check`, then `make test`

## Acceptance

- No screen shows a reply policy, quote policy, lock, or Detach.
- The composer, quote dialog, and edit form take up to 3 tags.

## Carried over
