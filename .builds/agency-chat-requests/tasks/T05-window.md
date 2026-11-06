# T05 Marketplace: Conversation window on messages and reads

## Requirements

MKT-REQ-004, MKT-REQ-005, MKT-CNV-002, MKT-CNV-006, MKT-DAT-005.

## Guides

`go.md`, `backend.md`, `federation.md`, `marketplace.md`.

## Exemplars

- `backend/handlers/orgs/contacts/conversations.go` `SendMessage`,
  `refusal`, `conversationSummary`, `readConversation`.
- `backend/internal/agencyconversations/commands.go` `handleReply`;
  `backend/internal/agencyconversations/read.go`.
- `backend/handlers/mesh/conversations.go` `readLocalConversation`.

## Steps

1. One helper in `backend/internal/agencycontacts` (for example
   `WriteWindow(row, now) (agencyUntil, hubUntil *time.Time)`) computing
   each side's write-until instant from `hub_activity_at`,
   `agency_activity_at`, and `window_seconds`; a NULL activity or window
   means that side may not write. Use it everywhere below; no second copy.
2. `SendMessage` (agency): after `refusal`, refuse with
   `org-conversation-closed` when the agency may not write; on success set
   `agency_activity_at = now`. A message from the agency while a
   `to_agency` request is pending accepts that request first
   (MKT-REQ-005): run the accept path T08 will expose; until T08 exists,
   put the accept effect in a shared function in `agencycontacts` that T08
   calls.
3. `handleReply` (Hub reply command): store `window_seconds` from the
   payload; reject with `hub-conversation-closed` when the Hub user may not
   write; set `hub_activity_at = now`; a pending `to_hub_user` request is
   accepted first. `ReplyToConversation` in hub-api sends the window.
4. `StartConversation` (removed in T17) sets `hub_activity_at` and
   `agency_activity_at` to now and `window_seconds` to 7,776,000 so its
   conversations stay writable until then; say so in a one-line comment
   naming T17.
5. Reads: `conversationSummary` and the Hub summary fill
   `agency_may_write_until`, `hub_may_write_until`, and `pending_request`;
   the mesh read returns the window instants and the pending request's
   note; the pointer sync carries the instants (T03).
6. Go tests for the helper (both sides, NULLs, boundary equal to now is
   closed) in `agencycontacts`.

## Tests

Unit tests of step 6; Playwright in T06.

## Checks

`make test-go`, `make test-go-static`, `make typespec-check`.

## Acceptance

- Each side's writes are refused once the other side's activity plus the
  window has passed; an agency cannot keep a conversation open alone.
- Both portals' reads expose the instants; existing conversation specs pass.

## Carried over
