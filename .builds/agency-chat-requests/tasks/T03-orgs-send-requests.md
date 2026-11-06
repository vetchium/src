# T03 Orgs: Send, list, and count agency chat requests

## Requirements

MKT-REQ-001, MKT-REQ-002, MKT-REQ-003, MKT-REQ-006, MKT-REQ-011,
MKT-DAT-003, MKT-DAT-004, MKT-DAT-007, MKT-CON-001, MKT-CON-005,
MKT-CNV-003.

## Guides

`go.md`, `backend.md`, `database.md`, `federation.md`, `marketplace.md`,
`authorization.md`.

## Exemplars

- `backend/handlers/orgs/contacts/conversations.go` `StartConversation`
  (profile read, `confirmSuggestion`, Org lock, Contact creation, caps,
  `RunIdempotent`), `readProfile` in `profile.go`.
- `backend/internal/agencycontacts/agencycontacts.go` `SyncPointer`,
  `enqueuePointer`, `applyPointer`.
- `backend/handlers/orgs/contacts/read.go` `ListContacts` (signed keyset
  pagination with `sign`/`verify`).
- Route registration in `backend/internal/routes/orgs_routes.go`
  (`fulfilEngagements(...)`).

## Steps

1. New file `backend/handlers/orgs/contacts/requests.go`:
   `SendChatRequest`. Resolve the person by `address` through `readProfile`
   or by `contact_id` (`org-contact-not-found`); refuse
   `!AgenciesMayMessage` with the existing `org-agency-messages-off` (T10
   renames it); `confirmSuggestion`. In `RunIdempotent`
   (`orgs:send-chat-request`): lock the Org; require a listed `sourcing`
   Listing (`org-listing-not-available`); create the Contact when none
   exists under MKT-CON-005 as `StartConversation` does; lock the Contact;
   apply MKT-REQ-003 in order (party deleted → pending exists → agency may
   still write, i.e. `hub_activity_at + window_seconds > now` → block);
   check `CountOrgChatRequestsCreatedOn` < 50
   (`contacts.MaxChatRequestsPerDay`, `org-chat-request-limit-reached`);
   `CreateOrgChatRequest` with `direction = to_hub_user`, sender email as
   display name (MKT-GEN-005); then `agencycontacts.SyncPointer` with the
   request (no note) and `new_agency_request: true`. Return `ChatRequest`.
2. `ListChatRequests` and `CountPendingChatRequests` in the same file
   (purpose `orgs-list-chat-requests-v1` for the signed cursor).
3. Extend `agencycontacts.SyncPointer`/`enqueuePointer` to carry the
   pointer's `request`, `has_request`, and both write-until instants
   (computed: agency until `hub_activity_at + window`, Hub until
   `agency_activity_at + window`), and `applyPointer` (Hub side) to store
   them and to insert a `hub_message_notices` row of kind `request` when
   `new_agency_request` is set. Extend `queue_hub_message_emails.go` and the
   Hub email template to word each kind (name the agency, never content;
   every `hub-ui` email locale the existing notice uses).
4. `ListContacts` gains `pending_request_direction` and the `requests`
   filter (any pending request).
5. Register the three routes under `fulfilEngagements`.
6. Go integration test `backend/internal/agencycontacts/` or a new
   `backend/handlers/orgs/contacts/requests_integration_test.go` following
   `agencyconversations_integration_test.go`: the MKT-REQ-003 order, the cap,
   and that the pointer event carries no note.

## Tests

The Go integration test of step 6. Playwright coverage lands in T06.

## Checks

`make sqlc`, `make test-go`, `make test-go-static`, `make typespec-check`.

## Acceptance

- An agency can send a request, sees it in `list-chat-requests`
  (`to_hub_user`), and the Hub pointer shows it without the note.
- Every refusal of MKT-REQ-003 and the 50-per-day cap answer with their
  problem types; audit rows exist for each send.

## Carried over

- From T01: the contract added `ContactCounts.requests` (Contacts with a pending request in either direction), `Contact.latest_request` (latest request in any state, with `note` only while pending and `window_days` when known), and `ConversationSummary.agency_may_write_until`/`hub_may_write_until`. `ListContacts` must fill `counts.requests`; `GetContact` must fill `latest_request`. `count-pending-chat-requests` is `GET` with no body (like `my-interview-counts`), returning `PendingChatRequestCount`. The request names the person by `address` (a `ProfileAddress`) or `contact_id`.
- From T02: `CreateOrgChatRequest` counts only `to_hub_user` sends and bumps the Contact's `last_activity_at`; take `GetPendingOrgChatRequest` (by Contact, under `LockOrgContact`), `FindBlockingChatRequestBlock`, `GetLatestOrgChatRequest`, `ListPendingOrgChatRequests` then `ListAnsweredOrgChatRequests` (two keyset phases in one signed cursor), and `CountPendingOrgChatRequests` from `org_chat_requests.sql`. `UpsertHubAgencyPointer`, `GetHubAgencyPointer`, `InsertHubMessageNotice`, and `ClaimHubMessageNotice` do not yet carry `has_request`, `request`, the write-until columns, or the notice `kind`; extend them here. The schema checks `has_request = (request IS NOT NULL)`.
