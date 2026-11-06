# T10 Marketplace: Requests setting replaces the messages setting

## Requirements

MKT-REQ-008, MKT-CNV-006, MKT-CON-003, MKT-DAT-006, MKT-HUB-002,
MKT-HUB-004, MKT-UI-010.

## Guides

`typespec.md`, `go.md`, `backend.md`, `database.md`, `federation.md`,
`ui.md`, `marketplace.md`.

## Exemplars

- `backend/handlers/hub/users/` `SetAgenciesMayMessage`;
  `agencycontacts.applyMessagesChanged`, `EnqueueMessagesState`.
- `typespec/problem/orgs/marketplace.tsp` `org-agency-messages-off`;
  `typespec/problem/hub/conversations.tsp` `hub-agency-messages-off`.

## Steps

1. Contract: rename problem `org-agency-messages-off` to
   `org-agency-requests-off` (title "This person does not accept chat
   requests from agencies"); remove `hub-agency-messages-off` and the
   `messages_off` member of `ConversationReadOnlyReason`; update every
   operation's problem union. Rename the federation event
   `hub-agency-messages-changed` to `hub-agency-requests-changed` with
   payload field `requests_off`. Keep the Hub operation path and field
   `agencies_may_message`; reword its doc comment.
2. Schema: `org_contacts.messages_off` becomes `requests_off`; drop
   `messages_off` from both `read_only_reason` checks. Queries and sqlc.
3. Backend: the setting refuses only agency `send-chat-request`
   (`org-agency-requests-off`); remove every other use (`refusal`,
   `handleReply`, the Hub reply problem, conversation read-only by the
   setting). `StartConversation` keeps refusing with the renamed type until
   T17.
4. Orgs UI: the Contact's reason string becomes "This person does not
   accept chat requests from agencies" in every `orgs-ui` locale; remove the
   messages-off composer notice. Hub UI: the preferences label "Agencies may
   send me chat requests" and help saying accepted conversations continue,
   in every `hub-ui` locale.
5. Playwright: update `org-conversations.spec.ts` (the "agencies may
   message me toggle" test now proves requests refused, conversations and
   replies continuing, the profile view unchanged) and
   `playwright/lib/orgs-marketplace.ts` `awaitMessagesOff` →
   `awaitRequestsOff`; update UI specs that assert the old strings.

## Tests

The rewritten toggle test in `playwright/api/org-conversations.spec.ts`;
`typespec` tests for the renamed problem.

## Checks

`make typespec-check`, `make sqlc`, `make test-go`, `make orgs-ui-check`,
`make hub-ui-check`, `make playwright-check`, `make test`.

## Acceptance

No `messages_off`/`agency-messages-off` remains (`git grep -i
"messages.off"` finds only history-free hits); the setting refuses agency
requests only.

## Carried over
