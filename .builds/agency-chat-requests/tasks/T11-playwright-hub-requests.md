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
- From T06: `api/org-chat-requests.spec.ts` has `withAgency` (an agency with two assigned Openings, `person` seeding, `orgs` for cleanup), `expectAnswerAudited` (MKT-REQ-011 on both tenants), `backdate`, and the Orgs and Hub route-check tests. Add there: the Orgs `accept-chat-request`/`decline-chat-request` to the Orgs route checks (401, `org:fulfil_engagements` 403, invalid JSON, validation), the decliner sending its own request after declining (MKT-REQ-007), and the Hub-side MKT-REQ-003 order and Hub daily limit. A second agency for the same Opening is built in the Hub route-check test with `withProvider`, `published`, `activate`, and `assignOpeningProvider`.
- From T07: cover `/api/hub/list-opening-agencies` (every `chat_state`, no Org DID in the body, Opening not found, unpublished) and `/api/hub/send-chat-request` across tenants both ways (Hub in deu relays the agency read to sgp): `hub-agency-not-assigned` for an agency not on the Opening, pointer refusals (`hub-chat-request-exists` for either direction pending, `hub-conversation-open`, `hub-chat-request-blocked` from a `declined` pointer), the agency's refusal of an older `opening` block, the 10-per-day cap (`hub_chat_request_creations` preset 9; a pointer refusal does not count, an agency refusal does), a repeat with the same key replaying uncounted, 202 with `setOrgHome` on the agency, and the agency listing it `to_agency` with the note and `count-pending-chat-requests` counting it.
- From T08: the Orgs `accept-chat-request` (200 `ConversationDetail`) and `decline-chat-request` (200 `ChatRequest`) go through `agencycontacts.AnswerAgencyRequest`; cover `org-chat-request-not-found` for the agency's own, another agency's, and an already answered request, a second agency user answering (shared inbox), `org-conversation-party-deleted` on accept, and that the acceptance email names the agency only.
- From T09: `expire-chat-requests` runs every `1s` in CI (`workers.expireChatRequestsTimer`); for expiry backdate a pending request's `sent_at` past 14 days and poll until the agency lists it `expired` and the Hub pointer shows it with no block; for lifting backdate a `sender` block's `blocked_until` (and `created_at` before it) and poll until a new request is accepted. The job also prunes `org_chat_request_creations` and `hub_chat_request_creations` older than yesterday, so preset only today's count for the limit tests.
