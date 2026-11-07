# T07 Hub: Agencies on an Opening and Hub chat requests

## Requirements

MKT-REQ-002, MKT-REQ-003, MKT-REQ-006, MKT-REQ-011, MKT-DAT-014,
MKT-HUB-005, MKT-CON-001, MKT-CON-005, OPN-HUB-001, OPN-HUB-005,
OPN-HUB-007.

## Guides

`go.md`, `backend.md`, `database.md`, `federation.md`, `marketplace.md`,
`openings.md`.

## Exemplars

- `backend/handlers/mesh/openings.go` `PeerGetOrgOpening`,
  `RelayGetOrgOpening`; `backend/handlers/hub/openings/` (how hub-api reads
  a remote Org's Opening).
- `backend/handlers/hub/messages/messages.go` `ReplyToConversation`
  (command send).
- `backend/internal/agencyconversations/commands.go` (command handler).

## Steps

1. Consumer side: the `org-openings/get` peer response fills `agencies`
   from active `sourcing` engagements assigned to the Opening
   (`org_engagements.provider_org_did`, `provider_domain`,
   `provider_display_name`), only for a `published` Opening. Add the query
   to `backend/internal/db/queries/` beside the assignment queries.
2. Hub `ListOpeningAgencies` in a new
   `backend/handlers/hub/openings/agencies.go`: read the Opening as the
   Opening page does (same problems), then merge each agency with the Hub
   user's pointer for that `agency_org_did` into `OpeningAgency.chat_state`
   (`open` when the Hub user may write; `closed`; `request_sent`;
   `request_received`; `declined` with scope and lift date; `none`). Never
   return the Org DID.
3. Hub `SendChatRequest` in `backend/handlers/hub/messages/requests.go`:
   in one transaction lock the Hub user's row, refuse at 10 per UTC day
   (`hub-chat-request-limit-reached`) and increment
   `hub_chat_request_creations`; outside it read the Opening and agencies
   (`hub-org-unavailable`), refuse an unpublished Opening or an agency not
   listed (`hub-agency-not-assigned`); refuse from the pointer what it knows
   (pending exists, conversation open for the Hub user, declined block);
   mint the request id; send `hub-chat-request` with the window. `200`
   `HubChatRequest` on a certain answer, `202` otherwise. Audit.
4. Agency side: register `hub-chat-request`. Handler: require an active
   `sourcing` engagement with that consumer domain (reject
   `hub-agency-not-assigned`); lock or create the Contact with
   `created_by` NULL (T02) and no `org_contact_creations` increment
   (MKT-CON-005);
   apply MKT-REQ-003 for direction `to_agency` with `hub-*` problems;
   create the request with `window_seconds`; sync the pointer.
5. Routes: `/api/hub/list-opening-agencies`, `/api/hub/send-chat-request`
   with `hubAuth`.
6. Go integration tests for the agency-side handler.

## Tests

Go integration tests of step 6; Playwright in T11.

## Checks

`make sqlc`, `make sql-check`, `make test-go`, `make test-go-static`.

## Acceptance

- The Hub lists an Opening's agencies with the user's chat state; no DID in
  any Hub response.
- A Hub user's request reaches a remote agency, which lists it with
  `to_agency`; every refusal and the 10-per-day cap answer correctly.

## Carried over

- From T01: the assigned-agency read is its own mesh route, not a wider `org-openings/get`: relay `POST /mesh/org-openings/agencies` and peer `POST /api/mesh/org-openings/agencies`, request `MeshListOpeningAgenciesRequest` (= `GetOrgOpeningRequest`: `domain`, `opening_number`), response `MeshListOpeningAgenciesResponse { items: MeshOpeningAgency[] }`, `hub-opening-not-found` for any Opening that is not `published`. Replace step 1 with implementing these routes. The Hub requests use `domain` (not `org_domain`). The pointer keeps only the latest request, so `chat_state: declined` reflects that request; an older `opening` block surfaces as `hub-chat-request-blocked` from the command.
- From T02: `IncrementHubChatRequestCreations` takes `max_per_day` and returns `counted_rows = 0` once the day is full (report `hub-chat-request-limit-reached`); it audits `hub.chat-request.counted`. Count only a send `Sender.Known` has not seen, so a replay is not counted twice. A Hub user's request creates the Contact with `created_by` NULL.
- From T06: Hub `writeRejection` in `handlers/hub/messages/messages.go` maps only the problems it lists; add every new rejection the Hub request command can return (`hub-chat-request-exists`, `hub-conversation-open`, `hub-chat-request-blocked`, party deleted, agency requests off) or it surfaces as `hub-org-unavailable`. Like `answerChatRequest`, leave state checks to the agency so a repeated command with its key replays, and write the confirmed result to the local pointer before responding.
