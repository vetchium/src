# T16 Playwright: Chat request screens in both portals

## Requirements

MKT-UI-007, MKT-UI-008, MKT-UI-011, MKT-UI-012, MKT-HUB-001, MKT-HUB-002,
MKT-HUB-005, MKT-CNV-010.

## Guides

`playwright.md`, `typescript.md`.

## Exemplars

- `playwright/ui/hub-marketplace.spec.ts`,
  `playwright/ui/orgs-marketplace-agency.spec.ts`,
  `playwright/ui/orgs-home.spec.ts`, `playwright/lib/orgs-ui.ts`.

## Steps

1. `orgs-marketplace-agency.spec.ts`: send a chat request from Job detail
   and from a Contact; answer a Hub request from the Requests tab with
   each decline; the closed notice; the navigation count.
2. `orgs-home.spec.ts`: the Chat requests card shows to an agency user with
   `org:fulfil_engagements` and not to a user without it.
3. `hub-marketplace.spec.ts`: accept and decline an agency request in
   Messages; request a chat from the Opening page and see each state; the
   preferences label.
4. Replace every UI step that used "Send first message".

## Tests

The three specs above.

## Checks

`make playwright-check`; the three specs against `make test-environment`;
`make test`.

## Acceptance

Both portals' chat-request screens are covered end to end.

## Carried over
- From T12: cover the Orgs states on screen: dialog refusals (exists, conversation open, blocked, requests off) and Accept in place of Request, Requests tab sections, sent banner (pending, declined with lift date, expired), incoming banner answers, the closed-conversation notice, and Suggest to a contact handing off to a chat request when the agency may not write.
- From T13: Home "Chat requests" card: shown to an agency `org:fulfil_engagements` holder with pending requests (count in the title, five oldest, "See all" to the Requests tab) and hidden from a user without the permission or the `sourcing` Capability.
- From T14: cover the Hub Messages states on screen: an incoming request listed first with Accept, "Not this Opening" and "Not for N days" (each removing the request); Accept opening the composer at once; a sent request pending, declined (Opening, and sender with lift date) and expired; the closed notice after the window ends; `request` messages as Opening cards with apply only on the agency's.
