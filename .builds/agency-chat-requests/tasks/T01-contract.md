# T01 Contract: Chat request types, operations, and problems

## Requirements

MKT-REQ-001, MKT-REQ-002, MKT-REQ-003, MKT-REQ-004, MKT-REQ-005,
MKT-REQ-007, MKT-DAT-003, MKT-DAT-005, MKT-DAT-014, MKT-HUB-005, the
`marketplace.md` problem table.

## Guides

`typespec.md`, `federation.md`, `marketplace.md`, `go.md`, `typescript.md`.

## Exemplars

- `typespec/orgs/marketplace/contacts/contacts.tsp` with `contacts.go`,
  `contacts.ts`, `contacts_test.go` (`StartConversationRequest`,
  `SendMessageRequest`, `ConversationSummary`, `MessageKind`).
- `typespec/hub/messages/messages.tsp` with companions
  (`ReplyToConversationRequest`, `PendingMessageResponse`).
- `typespec/federation/marketplace.tsp` with companions
  (`HubConversationReplyPayload`, `AgencyPointerChangedPayload`,
  `HubConversationReplyKind`, `AgencyPointerChangedKind`).
- `typespec/problem/orgs/marketplace.tsp` and
  `typespec/problem/hub/conversations.tsp` with companions.
- `typespec/hub/openings/federation.tsp` (`org-openings/get` peer and relay
  models).

## Steps

1. In `typespec/orgs/marketplace/contacts/contacts.tsp` add:
   - `scalar ChatRequestID extends string` (UUIDv7 text, as `ContactID`).
   - `enum ChatRequestState { pending, accepted, declined, expired }`,
     `enum ChatRequestDirection { to_hub_user, to_agency }`,
     `enum ChatRequestDeclineScope { opening, sender }`.
   - `scalar ChatRequestNote extends string` with `@minLength(1)`
     `@maxLength(1000)` (code points; Go validates with
     `utf8.RuneCountInString` after trimming in `Normalize`).
   - `model ChatRequest { request_id; contact_id; direction; state;
     opening: OpeningSuggestion; note?: ChatRequestNote; hub_user_name;
     hub_user_handle; sent_at; answered_at?; decline_scope?; blocked_until? }`.
   - `model SendChatRequestRequest { address?: HubAddress; contact_id?:
     ContactID; suggestion: OpeningSuggestion; note?: ChatRequestNote }`
     (exactly one of `address` and `contact_id`; `Validate` reports both
     field names otherwise).
   - `ListChatRequestsRequest { direction: ChatRequestDirection;
     pagination_key?; limit? (1–100) }`, `ListChatRequestsResponse { items:
     ChatRequest[]; next_pagination_key? }` (pending first, oldest first;
     then answered newest first).
   - `CountPendingChatRequestsResponse { count: int32 }`.
   - `AcceptChatRequestRequest { request_id }`,
     `DeclineChatRequestRequest { request_id; scope: ChatRequestDeclineScope }`.
   - `MessageKind` gains `request`; `ConversationMessage` gains optional
     `note?: ChatRequestNote` used only by `request` messages (the Opening
     travels in `suggestion`).
   - `ConversationSummary` gains `agency_may_write_until?: utcDateTime`,
     `hub_may_write_until?: utcDateTime`, `pending_request?: ChatRequest`.
   - `ContactSummary` gains `pending_request_direction?:
     ChatRequestDirection`; `ContactFilter` gains `requests`.
   - Operations on `ContactOperations`: `/send-chat-request` (idempotent,
     86400 replay, binding as `/start-conversation`), `/list-chat-requests`,
     `/count-pending-chat-requests`, `/accept-chat-request` (idempotent),
     `/decline-chat-request` (idempotent). Keep `/start-conversation`;
     T17 removes it.
2. In `typespec/hub/messages/messages.tsp` add `HubChatRequest` (the
   `ChatRequest` fields without `hub_user_*`, plus `agency_display_name`,
   `agency_domain`), `ListHubChatRequestsRequest/Response`,
   `HubSendChatRequestRequest { org_domain; opening_number; agency_domain;
   note? }`, `HubAcceptChatRequestRequest { request_id }`,
   `HubDeclineChatRequestRequest { request_id; scope }`,
   `ListOpeningAgenciesRequest { org_domain; opening_number }`,
   `OpeningAgency { agency_display_name; agency_domain; chat_state:
   OpeningAgencyChatState; contact_id?; request?: HubChatRequest }` with
   `enum OpeningAgencyChatState { none, open, closed, request_sent,
   request_received, declined }`, `ListOpeningAgenciesResponse { items }`.
   `HubConversationSummary` gains `agency_may_write_until?`,
   `hub_may_write_until?`, `pending_request?: HubChatRequest`. Operations:
   `/list-opening-agencies`, `/send-chat-request` (200 `HubChatRequest` or
   202), `/list-chat-requests`, `/accept-chat-request` (200
   `HubConversationDetail` or 202), `/decline-chat-request` (200 or 202).
3. Problems: in `typespec/problem/orgs/marketplace.tsp` add
   `org-chat-request-limit-reached` 429, `org-chat-request-exists` 409,
   `org-chat-request-blocked` 403, `org-chat-request-not-found` 404,
   `org-conversation-open` 409, `org-conversation-closed` 409,
   `org-agency-requests-off` 403. In `typespec/problem/hub/conversations.tsp`
   add `hub-chat-request-limit-reached` 429, `hub-chat-request-exists` 409,
   `hub-chat-request-blocked` 403, `hub-chat-request-not-found` 404,
   `hub-conversation-open` 409, `hub-conversation-closed` 409,
   `hub-agency-not-assigned` 422. Titles from the `marketplace.md` table.
   Wire each onto the operations above per the BRIEF API table. Leave
   `org-conversation-limit-reached`, `org-agency-messages-off`, and
   `hub-agency-messages-off` for T10 and T17.
4. Federation (`typespec/federation/marketplace.tsp` and companions):
   - Commands `hub-chat-request` (`HubChatRequestPayload { contact_id?;
     agency_org_did; hub_user_did; hub_user_display_name; hub_user_handle;
     consumer_domain; opening_number; note?; window_seconds; request_id }`;
     `request_id` is minted by the Hub tenant as UUIDv7 and is the aggregate),
     `hub-chat-request-answer` (`{ request_id; contact_id; hub_user_did;
     accept: boolean; scope?; window_seconds; hub_user_display_name;
     hub_user_handle }`).
   - `HubConversationReplyPayload` gains `window_seconds: int64`.
   - `AgencyPointerChangedPayload` gains `agency_may_write_until?`,
     `hub_may_write_until?`, `request?: AgencyPointerRequest` (`{ request_id;
     direction; state; consumer_domain; opening_number; sent_at;
     decline_scope?; blocked_until? }`, never the note), `new_agency_request?:
     boolean`, `request_accepted_by_agency?: boolean`.
   - `MeshReadConversationResponse` gains `agency_may_write_until?`,
     `hub_may_write_until?`, `pending_request_note?: ChatRequestNote`.
   - The `org-openings/get` peer response gains `agencies:
     MeshOpeningAgency[]` (`{ agency_org_did; agency_domain;
     agency_display_name }`), mesh-only; `PublicOpening` is unchanged.
5. Go companions: types, constants, `Normalize`/`Validate`, problem
   variables, and `contacts_test.go`/`messages_test.go`/`marketplace_test.go`
   cases for every new validation rule (note trimming and the 1,000
   code-point bound on a copy; exactly one of `address`/`contact_id`; scope
   enum; `window_seconds` > 0).
6. TypeScript companions and `typespec/package.json` `exports` for any new
   file; `contacts.test.ts` cases mirroring the Go ones.
7. Run `npx tsp format` on changed `.tsp` files.

## Tests

`typespec` Go tests (`go test ./...` in `typespec/`) and `npm run test:ts`
for every validation rule added in steps 5–6.

## Checks

`make typespec-check`, `make test-go`, `make test-go-static`.

## Acceptance

- Every operation and problem in the BRIEF API table exists in TypeSpec, Go,
  and TypeScript; `start-conversation` still compiles.
- No note text appears in any federation event payload.
- Contract compiles; all typespec tests pass.

## Carried over
