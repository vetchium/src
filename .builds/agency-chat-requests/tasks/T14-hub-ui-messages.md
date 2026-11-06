# T14 Hub UI: Chat requests and the window in Messages

## Requirements

MKT-HUB-001, MKT-HUB-004, MKT-CNV-010, MKT-REQ-007.

## Guides

`ui.md`, `ux.md`, `typescript.md`, `marketplace.md`.

## Exemplars

- `hub-ui/src/pages/MessagesPage.tsx`, `hub-ui/src/features/messages/queries.ts`,
  `hub-ui/src/api/hub.ts`.

## Steps

1. API client and hooks for `list-chat-requests`, `accept-chat-request`,
   `decline-chat-request`; handle `202` as the reply does.
2. `MessagesPage`: pending requests to the user first (agency, Opening card
   linking to `/org/:domain/openings/:number`, sent at; note on opening),
   with Accept, "Not this Opening", "Not for <N> days"; then conversations
   and sent requests by last activity with their state. `request`
   messages render as an Opening card (apply link only for an agency's).
   Closed composer notice per MKT-CNV-010 linking the agency's suggested
   Openings.
3. Strings in every `hub-ui` locale.

## Tests

Playwright UI in T16.

## Checks

`make hub-ui-check`.

## Acceptance

A Hub user answers agency requests and sees why they cannot write.

## Carried over
- From T04: `list-conversations` items may have `has_conversation` false with only `latest_request`; open those as a request, not a conversation.
