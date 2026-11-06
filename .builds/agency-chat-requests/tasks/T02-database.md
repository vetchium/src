# T02 Database: Chat request tables, window columns, and conversationWindow config

## Requirements

MKT-REQ-001, MKT-REQ-003, MKT-REQ-004, MKT-REQ-006, MKT-REQ-007,
MKT-REQ-012, MKT-DAT-003.

## Guides

`database.md`, `go.md`, `backend.md`, `marketplace.md`.

## Exemplars

- `db/migrations/00001_init.sql`: `org_conversations`,
  `org_conversation_messages`, `org_conversation_creations`,
  `org_contact_creations`, `hub_agency_pointers`, `hub_message_notices`.
- `backend/internal/db/queries/org_conversations.sql`,
  `backend/internal/db/queries/org_contacts.sql`.
- `backend/internal/appconfig/config.go` `Marketplace`,
  `fileMarketplace`, `deletedPartyConversationRetention` parsing and
  `config_test.go`.

## Steps

1. Edit `db/migrations/00001_init.sql` in place (pre-launch; no ALTER
   migrations), beside the conversation tables:
   - `vetchium.org_chat_requests`: `request_id uuid PK` (UUIDv7 check),
     `contact_id uuid NOT NULL REFERENCES org_contacts ON DELETE CASCADE`,
     `org_did uuid NOT NULL`, `hub_user_did uuid NOT NULL`, `direction text
     CHECK IN ('to_hub_user','to_agency')`, `state text CHECK IN
     ('pending','accepted','declined','expired')`, `consumer_domain text`,
     `opening_number integer >= 1`, `note text NULL` (trimmed, 1–1000
     chars), `sender_user_id uuid NULL REFERENCES org_users ON DELETE SET
     NULL`, `sender_display_name text NOT NULL`, `window_seconds bigint NULL
     CHECK > 0` (set when the Hub tenant sent it), `sent_at`, `answered_at
     NULL`, `answered_by uuid NULL`, `decline_scope text NULL CHECK IN
     ('opening','sender')`, checks: note NULL unless `pending`;
     `decline_scope` only when `declined`. Unique partial index one
     `pending` per `(org_did, hub_user_did)`; index `(org_did, direction,
     state, sent_at)`; index `(state, sent_at)` for expiry.
   - `vetchium.org_chat_request_blocks`: `contact_id` FK cascade,
     `blocked_direction text` (the sender's direction), `scope`,
     `consumer_domain NULL`, `opening_number NULL` (both set iff `opening`),
     `blocked_until timestamptz NULL` (set iff `sender`), `created_at`;
     unique `(contact_id, blocked_direction, consumer_domain,
     opening_number)` for `opening`; index on `blocked_until`.
   - `vetchium.org_chat_request_creations (org_did, created_on, created)` as
     `org_conversation_creations` (keep the old table until T17).
   - `org_conversations` gains `hub_activity_at timestamptz NULL`,
     `agency_activity_at timestamptz NULL`, `window_seconds bigint NULL
     CHECK > 0`.
   - `org_conversation_messages.kind` allows `request`; content check: a
     `request` message has `consumer_domain` and `opening_number`, optional
     `message_text` (1–1000), any `sender_type`.
   - `org_contacts.created_by` becomes nullable, with a column comment that
     NULL means a Hub user's chat request created the Contact (MKT-CON-005);
     every reader that names the creator shows none for NULL. Renaming
     `messages_off` is T10; leave it.
   - `hub_agency_pointers` gains `agency_may_write_until`,
     `hub_may_write_until`, `request jsonb NULL`, `has_request boolean NOT
     NULL DEFAULT false`; the list index predicate becomes
     `has_conversation OR has_request`.
   - `vetchium.hub_chat_request_creations (hub_user_did FK hub_users
     cascade, created_on date, created int >= 1, PK both)`.
   - `hub_message_notices` gains `kind text NOT NULL DEFAULT 'message'
     CHECK IN ('message','request','request_accepted')`.
   - Add every new table to the trigger loop exactly as the file's ending
     loop requires (`database.md`).
2. Queries in a new `backend/internal/db/queries/org_chat_requests.sql`:
   `LockPendingChatRequestByPair`, `GetPendingChatRequestByPair`,
   `GetOrgChatRequest` (by org and id), `CreateOrgChatRequest` (insert +
   creations counter + audit in one statement, returning row counts like
   `CreateOrgConversation`), `CountOrgChatRequestsCreatedOn`,
   `ListOrgChatRequests` (keyset by direction; pending oldest first, then
   answered newest first), `CountPendingOrgChatRequests` (`to_agency`),
   `AnswerOrgChatRequest` (state, answered_at/by, scope, clears note, audit),
   `CreateOrgChatRequestBlock`, `FindBlockingChatRequestBlock` (opening
   match or live sender block), `ExpirePendingChatRequests` (bounded batch,
   returns rows), `DeleteLiftedChatRequestBlocks` (bounded). In
   `org_conversations.sql`: `SetConversationActivity` (sets
   `hub_activity_at`/`agency_activity_at` with `GREATEST`, and
   `window_seconds`), `CreateOrgConversationFromRequest` (no daily counter).
   Hub side in `backend/internal/db/queries/hub_chat_requests.sql`:
   `CountHubChatRequestsCreatedOn`, `IncrementHubChatRequestCreations`.
3. Config: `Marketplace.ConversationWindow time.Duration` from
   `marketplace.conversationWindow`; startup refuses missing or
   non-positive (copy `deletedPartyConversationRetention`). Add
   `"conversationWindow": "2160h"` to every file `git grep -l
   deletedPartyConversationRetention` lists (config, config/ci,
   config/ci/fixtures, deploy, deploy/staging). Add `config_test.go` cases.
4. `make sqlc`.

## Tests

`backend/internal/appconfig/config_test.go`: missing, zero, negative, and
valid `conversationWindow`. `make migration-check` proves the schema applies
and resets.

## Checks

`make sqlc`, `make sql-check`, `make migration-check`, `make test-go`,
`make test-go-static`, `make repository-json-check`.

## Acceptance

- Schema holds every column above with its checks; one pending request per
  pair is enforced by an index.
- Every checked-in config parses with `conversationWindow`.
- Existing behavior unchanged; `make test` passes.

## Carried over
