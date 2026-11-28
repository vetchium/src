# T22 Playwright: Test the Hub thread screens

## Requirements

T21 behaviors

## Guides

`agent-guides/playwright.md`, `playwright/AGENTS.md`, `agent-guides/posts.md`

## Exemplars

- `playwright/ui/hub-posts.spec.ts` (T15), `playwright/ui/hub-marketplace.spec.ts`

## Steps

1. Create `playwright/ui/hub-post-replies.spec.ts`.
2. Cover: reply and sub-reply appear; no Reply button on a sub-reply;
   locked post hides the composer; blocked replier sees the refusal; Load
   more for 21 replies and for child pages; placeholder; the author's hidden
   label; Hide and Unhide by the owner; Edit inside the window and none after
   it; Remove with confirm and cancel; names arrive after handles (delay the
   `read-cards` route in the test); reply link route scrolls to and
   highlights a sub-reply; Replies tab with "The post was removed"; muted
   notice; a cross-region reply.

## Tests

`playwright/ui/hub-post-replies.spec.ts`.

## Checks

- `make playwright-check`
- `make test-environment`, then
  `npx playwright test ui/hub-post-replies.spec.ts --workers=2`
- `make fmt`, `git diff --check`, then `make test` once

## Acceptance

- Every T21 behavior maps to a named test.

## Carried over

From T21 (orchestrator): PST-THR-003 now also shows a `hidden_by_owner` reply with its words to the post owner. Before the UI tests, do this:
1. In `backend/internal/postread/replies.go` `ShapeReply`, return `hidden` with the body when the viewer is the reply author or the post owner. Pass the post owner DID in.
2. In the thread UI, show the post owner a hidden reply with the label "Hidden" and Unhide. The reply author still sees "Hidden by the post author". Add the strings to `en.ts`, `de.ts`, and `ta.ts`.
3. Add a Go unit test in `postread/replies_test.go`, an API test in `hub-post-replies.spec.ts` (the owner reads a hidden reply with no children; a third user does not), and the UI test (the owner hides a reply with no sub-replies, still sees it, and unhides it).
