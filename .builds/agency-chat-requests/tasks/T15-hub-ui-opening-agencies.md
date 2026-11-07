# T15 Hub UI: Agencies on the Opening page

## Requirements

MKT-HUB-005, MKT-HUB-004, MKT-REQ-003, MKT-REQ-006.

## Guides

`ui.md`, `ux.md`, `typescript.md`, `marketplace.md`, `openings.md`.

## Exemplars

- `hub-ui/src/pages/OrgOpeningPage.tsx`,
  `hub-ui/src/features/openings/queries.ts`.

## Steps

1. Hook for `list-opening-agencies` and `send-chat-request` (`202`
   handled as other Hub commands).
2. In `OrgOpeningPage.tsx` an "Agencies working on this Opening" section
   per MKT-HUB-005: each agency's name and domain with its state —
   Open conversation (link to `/messages/:contactId`), Request pending,
   Accept (inline answer), Declined (scope, lift date), or "Request chat"
   opening a dialog with the Opening fixed and a note with a live count.
   Show every `hub-*` request problem in the dialog. Hide the section when
   there are no agencies.
3. Strings in every `hub-ui` locale.

## Tests

Playwright UI in T16.

## Checks

`make hub-ui-check`.

## Acceptance

A Hub user sees an Opening's agencies and requests a chat from the page.

## Carried over
- From T07: `list-opening-agencies` returns `chat_state` per agency: `none` or `closed` offer Request; `request_sent` shows pending; `request_received` offers Accept (MKT-REQ-003); `open` links to the conversation by `contact_id`; `declined` shows `latest_request.decline_scope` and `blocked_until`.
