# T04 Hub: Answer agency chat requests

## Requirements

MKT-REQ-002, MKT-REQ-004, MKT-REQ-005, MKT-REQ-007, MKT-REQ-011,
MKT-REQ-012, MKT-DAT-005, MKT-DAT-008, MKT-SRC-004.

## Guides

`go.md`, `backend.md`, `database.md`, `federation.md`, `marketplace.md`.

## Exemplars

- `backend/handlers/hub/messages/messages.go` `ReplyToConversation`
  (command send, `202` `PendingOperation`, `writeRejection`).
- `backend/internal/agencyconversations/commands.go` `Register`,
  `handleReply`, `decode`, `HubUserInitiator`.
- `backend/internal/federation/commandkinds/registry.go`.

## Steps

1. Hub handlers in a new `backend/handlers/hub/messages/requests.go`:
   `ListChatRequests` (from pointers with `has_request`, direction filter,
   signed cursor purpose `hub:chat-requests:list`), `AcceptChatRequest`,
   `DeclineChatRequest`. The latter two check the pointer holds a
   `pending` `to_hub_user` request with that id
   (`hub-chat-request-not-found`) and send `hub-chat-request-answer` with
   `window_seconds = s.Config.Marketplace.ConversationWindow` in seconds and
   the user's current name and handle. Audit the initiation in the Hub
   tenant.
2. Agency side in `agencyconversations`: register
   `hub-chat-request-answer` with `HubUserInitiator`. Handler: lock the
   Contact; the request must be `pending`, `to_hub_user`, for this Hub
   user (`hub-chat-request-not-found` rejection). Accept: create the
   conversation if none (`CreateOrgConversationFromRequest`, recorded names
   from the payload and `GetAgencyDetails`), append a `request` message at
   the request's `sent_at` with the note and Opening, set
   `agency_activity_at = sent_at`, `hub_activity_at = now`,
   `window_seconds` from the payload, mark `accepted`, clear the note, add
   the Opening to the pointer suggestions (MKT-DAT-008), sync the pointer.
   Decline: mark `declined` with scope, delete the note, create the block
   (`opening`: Opening; `sender`: `blocked_until = now + window_seconds`),
   sync the pointer with `blocked_until`. Audit each effect without the
   note.
3. Hub `AcceptChatRequest` returns `HubConversationDetail` on a certain
   answer by reading the conversation as `GetConversation` does; `202`
   otherwise.
4. Register the three Hub routes in `backend/internal/routes/hub_routes.go`
   with `hubAuth`.
5. Extend `agencyconversations_integration_test.go`: accept creates the
   conversation with a `request` message and a suggestion; a second accept
   is rejected; decline of each scope creates the right block.

## Tests

Go integration test of step 5; Playwright in T06.

## Checks

`make sqlc`, `make test-go`, `make test-go-static`.

## Acceptance

- A Hub user lists, accepts, and declines agency requests across tenants.
- Accepting yields a conversation whose first message is the request and
  whose Opening counts as a suggestion; declining deletes the note.

## Carried over

- From T01: the Hub list items are `HubChatRequest` (no note; `window_days` from `marketplace.conversationWindow`); `HubConversationSummary.latest_request` carries the latest request; the note reaches the Hub only through `HubConversationDetail.pending_request_note` from `MeshReadConversationResponse.pending_request_note`. Decline returns `HubChatRequest`. Command kinds: `federationspec.HubChatRequestAnswerKind` with `HubChatRequestAnswerPayload` (scope exactly when declining; `window_seconds` >= 1).
- From T02: accept appends the request message with `AddOrgConversationMessage` (`kind` `request`, `sent_at` = the request's sent time, `message_text` = the note); that message leaves `agency_unread_count` unchanged and never moves activity back. `CreateOrgConversationFromRequest` audits the creation with the request id; `SetConversationActivity` stamps activity and the window with `GREATEST`/`COALESCE`. `AnswerOrgChatRequest` clears the note, so read it with `GetOrgChatRequest` first. `CreateOrgChatRequestBlock` has no audit of its own and runs beside `AnswerOrgChatRequest`.
- From T03: `agencycontacts.SyncPointer` takes a `Notice` (`NoNotice`, `NoticeMessage`, `NoticeRequest`, `NoticeRequestAccepted`) and already carries the latest request (no note), both write-until instants, and the agency name for a request without a conversation; the Hub pointer stores `has_request`, `request` (JSON `AgencyPointerRequest`), and the instants. `ListHubAgencyConversations` still filters `has_conversation = true`; widen it to `has_conversation OR has_request` when the Hub list shows requests. When declining with scope `sender`, set the block's `blocked_until` to the answer's `answered_at` + `window_seconds` so it equals `agencycontacts.BlockedUntil`. The orgs `message()` builder puts a `request` message's `message_text` into `text`; map it to `note` instead.
