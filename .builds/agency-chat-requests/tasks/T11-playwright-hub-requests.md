# T11 Playwright: Hub chat requests, expiry, and the requests setting

## Requirements

MKT-TST-001, MKT-TST-002, MKT-REQ-002, MKT-REQ-003, MKT-REQ-005,
MKT-REQ-006, MKT-REQ-007, MKT-REQ-008, MKT-REQ-009, MKT-DAT-014,
MKT-HUB-005, MKT-CON-005.

## Guides

`playwright.md`, `typescript.md`, `marketplace.md`.

## Exemplars

- `playwright/api/org-chat-requests.spec.ts` (T06).
- `playwright/api/org-referrals.spec.ts` (Openings with assigned agencies
  across tenants via `withWorld`, `assign`).
- `playwright/api/hub-org-openings.spec.ts` (Hub reading an Opening).

## Steps

1. Client methods: `HubAPI.listOpeningAgencies`, `HubAPI.sendChatRequest`;
   `OrgsAPI.acceptChatRequest`, `declineChatRequest`.
2. New `playwright/api/hub-chat-requests.spec.ts`:
   - Opening agencies: lists every assigned agency (local and remote),
     none for an unassigned Opening, no DID in the response, each chat
     state as it changes;
   - send: unpublished Opening and unassigned agency
     (`hub-agency-not-assigned`), daily cap 10 (preset
     `hub_chat_request_creations`), each MKT-REQ-003 refusal with `hub-*`
     types, remote agency `202` then recovery when its tenant is down;
   - agency answers: accept opens the conversation and the Hub user may
     write; decline `opening` and `sender` bind only the Hub user's
     direction (the agency may still request the Hub user);
   - the Hub-created Contact does not count toward MKT-CON-005 (preset
     `org_contact_creations` at 200 and still accepted);
   - an agency message while a Hub request is pending accepts it;
   - the requests setting off refuses agency requests but not the Hub
     user's own request, and accepted conversations continue;
   - expiry: backdate `sent_at` 14 days and wait for the worker; state
     `expired`, no block, a new request allowed.
3. Extend `org-chat-requests.spec.ts` with "the decliner may still send its
   own request" now that Hub requests exist.

## Tests

`playwright/api/hub-chat-requests.spec.ts`, the extended
`org-chat-requests.spec.ts`.

## Checks

`make playwright-check`; the two specs against `make test-environment`;
`make test`.

## Acceptance

Every bullet in step 2 is a passing test.

## Carried over
