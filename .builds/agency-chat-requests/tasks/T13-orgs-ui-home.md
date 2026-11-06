# T13 Orgs UI: Chat requests card on Home

## Requirements

MKT-UI-011, MKT-REQ-010, MKT-UI-010.

## Guides

`ui.md`, `ux.md` (Home), `typescript.md`, `marketplace.md`.

## Exemplars

- `orgs-ui/src/pages/HomePage.tsx` (the marketplace jobs and proposals
  preview cards, counts, permission gating).

## Steps

1. Add a "Chat requests" preview card to `HomePage.tsx` shown only to
   `org:fulfil_engagements` holders of an Org with a `sourcing` Listing or
   engagement: `list-chat-requests` `to_agency` limit 5 (Hub user name,
   handle, Opening, note start, sent at), the pending count in the title,
   each row linking to `/sourcing/contacts/:id`, "See all" to the Requests
   tab. Empty state as the other cards.
2. Strings in every `orgs-ui` locale.

## Tests

Playwright UI in T16.

## Checks

`make orgs-ui-check`.

## Acceptance

Home shows pending Hub requests to the right users only.

## Carried over
