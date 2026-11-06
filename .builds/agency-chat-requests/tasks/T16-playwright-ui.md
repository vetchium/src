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
