# T08 Orgs: Answer Hub chat requests

## Requirements

MKT-REQ-002, MKT-REQ-004, MKT-REQ-005, MKT-REQ-007, MKT-REQ-010,
MKT-REQ-011, MKT-REQ-012, MKT-CNV-004.

## Guides

`go.md`, `backend.md`, `database.md`, `federation.md`, `marketplace.md`.

## Exemplars

- The accept and decline effects T04 wrote in `agencyconversations` and the
  shared accept function T05 put in `agencycontacts`.
- `backend/handlers/orgs/contacts/conversations.go` `SendMessage`
  (`RunIdempotent`, Contact lock).

## Steps

1. `AcceptChatRequest` and `DeclineChatRequest` in
   `backend/handlers/orgs/contacts/requests.go`: lock the Contact; the
   request must be `pending` and `to_agency` for this Org
   (`org-chat-request-not-found`). Accept reuses the shared accept function
   with roles swapped: `hub_activity_at = sent_at`, `agency_activity_at =
   now`, `window_seconds` from the request row, `request` message from the
   Hub user (no suggestion added to the pointer). Decline creates the
   block with `blocked_until = now + request.window_seconds` for `sender`.
   The answering user's email is recorded as `answered_by`.
2. Pointer sync sets `request_accepted_by_agency` on accept; the Hub
   `applyPointer` inserts a `hub_message_notices` row of kind
   `request_accepted`; the email names the agency and the Opening number,
   never the note.
3. Register both routes under `fulfilEngagements`.
4. Go integration test: accept and decline, shared-inbox (a second agency
   user may answer), and a second answer refused.

## Tests

Go integration test of step 4; Playwright in T11.

## Checks

`make test-go`, `make test-go-static`.

## Acceptance

- Any agency user with `org:fulfil_engagements` answers a Hub request; the
  Hub user sees the result on the pointer and is emailed on acceptance.

## Carried over
