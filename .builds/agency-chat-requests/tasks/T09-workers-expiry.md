# T09 Workers: Expire chat requests and lift blocks

## Requirements

MKT-REQ-009, MKT-REQ-011, MKT-REQ-012, MKT-CON-004.

## Guides

`go.md`, `backend.md`, `database.md`, `marketplace.md`.

## Exemplars

- `backend/internal/workers/expire_org_engagements.go` (bounded batches,
  audit, outbox in the same transaction).
- `backend/internal/workers/retain_org_contacts.go` (`retainContact`).
- `backend/internal/workers/workers.go` job list and timers
  (`RetainOrgContactsTimer`).

## Steps

1. New `backend/internal/workers/expire_chat_requests.go`: in bounded
   batches, mark `pending` requests with `sent_at + 14 days <= now`
   `expired`, delete their notes, audit with actor `system`, and sync each
   pointer through `agencycontacts.SyncPointer`. Then delete `sender`
   blocks whose `blocked_until <= now` and sync the pointer.
2. Register the job `expire-chat-requests` with a new
   `ExpireChatRequestsTimer`, set in every config that sets
   `RetainOrgContactsTimer` to the same value.
3. `retain_org_contacts.go`: keep a Contact with a `pending` request or a
   block; count its 730 days from its latest request `sent_at` too.
4. Integration test `expire_chat_requests_integration_test.go` following
   `expire_application_offers_integration_test.go`: expiry at 14 days, not
   before; block lifting; retention keeps a blocked Contact.

## Tests

Step 4.

## Checks

`make test-go`, `make test-go-static`, `make repository-json-check`.

## Acceptance

Unanswered requests expire after 14 days with no block; lifted `sender`
blocks disappear; Contacts with requests or blocks survive retention.

## Carried over
- From T02: `ExpirePendingChatRequests` and `DeleteLiftedChatRequestBlocks` are bounded batches that lock each Contact with `SKIP LOCKED` and audit; sync each returned Contact's pointer in the same transaction. No query prunes `org_chat_request_creations` or `hub_chat_request_creations` yet; add them like `PruneOrgConversationCreations` and run them from the retention workers in each tenant.
