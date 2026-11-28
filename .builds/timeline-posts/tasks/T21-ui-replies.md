# T21 Hub portal: Add threads and the Replies tab

## Requirements

PST-RPL-002, PST-RPL-012, PST-THR-002 to PST-THR-006, PST-TAB-001,
PST-TAB-002, PST-BLK-005, PST-UI-002, PST-UI-005, Hub portal rows
`/u/:address/posts/:postId` and `/u/:address/posts/:postId/replies/:replyId`

## Guides

`agent-guides/ui.md`, `agent-guides/ux.md`, `agent-guides/typescript.md`,
`agent-guides/posts.md`

## Exemplars

- `hub-ui/src/pages/PostPage.tsx`, `hub-ui/src/features/posts/` (T14)
- `hub-ui/src/app/PendingOperationContext.tsx` (`202` handling)
- `hub-ui/src/pages/MessagesPage.tsx` (composer with an idempotency key)

## Steps

1. Hooks for T16 operations in `hub-ui/src/features/posts/queries.ts`. The
   reply mutation keeps one idempotency key per draft and handles `202`
   through `PendingOperationContext`.
2. `hub-ui/src/features/posts/Thread.tsx` on `PostPage`: top-level replies
   with Load more; each with "Show N replies" that loads child pages with
   Load more; placeholders with "This reply is not available"; the label
   "Hidden by the post author" for the viewer's own hidden reply; the handle
   first, then names and pictures from `read-cards`.
3. Reply composer under the post and a Reply button on each top-level reply
   (none on sub-replies). Show `hub-post-replies-closed` and
   `hub-post-reply-refused` messages. Hide the composer when the post is
   locked or the policy is `nobody`.
4. Own reply: Edit inside 30 minutes, Remove with confirmation. Post owner:
   Hide and Unhide on each reply.
5. Route `u/:address/posts/:postId/replies/:replyId`: load the thread, load
   the child page that holds the reply when it is a sub-reply, scroll to it,
   and highlight it.
6. Replies tab on `ProfileViewPage.tsx` with Load more, the "The post was
   removed" state, and the muted notice.
7. Reply count on `PostCard` links to the post page.
8. Strings in `en.ts`, `de.ts`, `ta.ts`.

## Tests

UI specs come in T22.

## Checks

- `make hub-ui-check`, `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Threads and the Replies tab work against the T19 API.

## Carried over

From T19 (orchestrator): an `edit-reply` result carries `child_count` 0, because the author's tenant keeps no sub-reply counts. After an edit, keep the child count the thread already shows; take only `body`, `revision`, and `edited` from the result.
