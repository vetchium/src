# T17 Orgs: Remove start-conversation

## Requirements

MKT-CNV-002, MKT-CNV-003, MKT-REQ-006, the `marketplace.md` problem table.

## Guides

`typespec.md`, `go.md`, `backend.md`, `database.md`, `playwright.md`.

## Exemplars

`git grep -n -i "start-conversation\|startConversation\|StartConversation\|org_conversation_creations\|conversation-limit-reached\|ConversationLimitReached"`.

## Steps

1. Remove `/start-conversation` and `StartConversationRequest` from
   `typespec/orgs/marketplace/contacts/` (all three files and tests), the
   handler and its T05 activity stamp, the route, and
   `org-conversation-limit-reached` from the problem catalog (all three
   files).
2. Drop `org_conversation_creations` and `CreateOrgConversation`'s daily
   counter and the queries using them; `make sqlc`.
3. Rewrite every Playwright API test that called `startConversation`
   (`org-conversations.spec.ts`, `org-contacts.spec.ts`,
   `org-referrals.spec.ts`) to open conversations with a request plus
   acceptance through a helper `openConversation(provider, applicant,
   opening)` in `playwright/lib/orgs-marketplace.ts`; delete the
   conversation-limit test (covered by T06's request cap).
4. `backend/cmd/dev-seed/marketplace.go`: open seeded conversations with a
   request and a Hub acceptance.
5. Leave `video-demos/` to T19.

## Tests

The rewritten specs; `make dev-seed` on a fresh `make dev` stack.

## Checks

`make typespec-check`, `make sqlc`, `make sql-check`, `make test-go`,
`make test-go-static`, `make playwright-check`, `make test`.

## Acceptance

`git grep -i "start-conversation\|startConversation\|conversation-limit-reached\|org_conversation_creations"`
finds only `video-demos/` (T19); `make test` passes.

## Carried over
