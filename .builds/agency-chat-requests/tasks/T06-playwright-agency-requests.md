# T06 Playwright: Agency chat requests and the conversation window

## Requirements

MKT-TST-001 (chat requests agency → Hub, window), MKT-TST-002 (tenant not
answering on accept/decline), MKT-REQ-001 to MKT-REQ-007, MKT-REQ-011,
MKT-CON-005.

## Guides

`playwright.md`, `typescript.md`, `marketplace.md`.

## Exemplars

- `playwright/api/org-conversations.spec.ts` (setup with `withProvider`,
  `published`, `listing`, `seedApplicant`, `awaitHubPointer`,
  `sqlScalarForTenant` to backdate and to preset daily counters,
  `expectProblem`, audit by idempotency key).
- `playwright/lib/orgs-api.ts`, `playwright/lib/hub-api.ts`,
  `playwright/lib/orgs-marketplace.ts`, `playwright/lib/orgs-routing.ts`
  (`assign`, `withWorld`).

## Steps

1. Add client methods: `OrgsAPI.sendChatRequest`, `listChatRequests`,
   `countPendingChatRequests`; `HubAPI.listChatRequests`,
   `acceptChatRequest`, `declineChatRequest` (idempotency keys as the
   existing write helpers).
2. Add `awaitHubRequest(hub, token, predicate)` to
   `playwright/lib/orgs-marketplace.ts` beside `awaitHubPointer`.
3. New `playwright/api/org-chat-requests.spec.ts`, each test named for the
   requirement it proves:
   - send by handle and by Contact; listed for the agency and the Hub user;
     no note in the Hub list or any audit row;
   - MKT-REQ-003 order: party deleted (backdate as the existing
     party-deleted test does), pending exists, conversation open, opening
     block, sender block;
   - daily cap 50 (`org_chat_request_creations` preset) and that a
     refused request still counts;
   - accept creates the conversation with a `request` message and a
     suggestion, reopening keeps history; a second request after the
     window reopens the same conversation;
   - decline `opening` refuses the same Opening but allows another;
     decline `sender` refuses every Opening until `blocked_until`, then
     allows (backdate the block); the decliner may still send its own
     request (after T07 lands, extend in T11);
   - window: backdate `hub_activity_at` past the window → agency
     `org-conversation-closed`, Hub reply still allowed while agency
     activity is recent and vice versa; the agency's own messages never
     extend its window; a changed `window_seconds` on the next Hub reply
     changes the instants;
   - a Hub reply to a conversation with a pending agency request accepts it;
   - a request-created Contact counts toward MKT-CON-005;
   - permission: `org:fulfil_engagements` required on all five Orgs routes;
   - tenant unavailable on accept and decline: `202`, then recovery
     (copy the unavailable test of `org-conversations.spec.ts`).

## Tests

`playwright/api/org-chat-requests.spec.ts`.

## Checks

`make playwright-check`; `npx playwright test api/org-chat-requests.spec.ts
api/org-conversations.spec.ts` against `make test-environment`;
`make test`.

## Acceptance

Every bullet in step 3 is a passing test; existing conversation specs pass.

## Carried over
- From T04: `list-conversations` now returns request-only pointers (`has_conversation` false, `latest_request` set); `get-conversation` on one is `hub-conversation-not-found`. `accept-chat-request` returns `HubConversationDetail` whose first message is the `request` message with `note`; a repeated accept is `hub-chat-request-not-found`.
- From T05: replies are refused with `hub-conversation-closed` once the agency's activity plus the window has passed, and agency messages with `org-conversation-closed` once the Hub user's has; `start-conversation` stamps both sides now with a 90-day window. Hub `get-conversation` opens a request-only pointer (no messages, `pending_request_note`). An agency message or Hub reply while the other side's request is pending accepts it first.
