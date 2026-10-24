-- Agency conversations (agent-guides/marketplace.md, Agency conversations).
-- The agency's tenant is authoritative for a conversation and its messages;
-- the Hub user's tenant keeps only the agency pointer.

-- name: CountOrgConversationsCreatedOn :one
SELECT COALESCE((
    SELECT c.created
    FROM vetchium.org_conversation_creations AS c
    WHERE c.org_did = sqlc.arg(org_did) AND c.created_on = sqlc.arg(day)::date
), 0)::integer AS created;

-- Creates the conversation of a Contact and counts it toward the day's limit
-- (MKT-CNV-003); the caller holds the Org lock. The first message follows in
-- AddOrgConversationMessage.
-- name: CreateOrgConversation :one
WITH created AS (
    INSERT INTO vetchium.org_conversations (
        conversation_id, contact_id, org_did, hub_user_did,
        recorded_hub_user_name, recorded_hub_user_handle,
        recorded_agency_name, recorded_agency_domain
    )
    VALUES (
        sqlc.arg(conversation_id), sqlc.arg(contact_id), sqlc.arg(org_did),
        sqlc.arg(hub_user_did), sqlc.arg(recorded_hub_user_name),
        sqlc.arg(recorded_hub_user_handle), sqlc.arg(recorded_agency_name),
        sqlc.arg(recorded_agency_domain)
    )
    RETURNING conversation_id, contact_id, hub_user_did
), counted AS (
    INSERT INTO vetchium.org_conversation_creations (org_did, created_on, created)
    SELECT sqlc.arg(org_did), sqlc.arg(day)::date, 1
    FROM created
    ON CONFLICT (org_did, created_on) DO UPDATE
    SET created = vetchium.org_conversation_creations.created + 1
    RETURNING created
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.conversation.created', 'org_conversation',
        created.conversation_id::text, 'org_user',
        sqlc.arg(actor_id)::uuid::text, created.hub_user_did,
        sqlc.arg(org_did), 'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('contact_id', created.contact_id::text)
    FROM created
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM created) AS created_rows,
    (SELECT count(*) FROM counted) AS counted_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- Appends a message: it records the parties' names as of now (MKT-CNV-001),
-- counts the agency's unread messages (MKT-DAT-010: a Hub user message adds
-- one, an agency message means the agency has read the conversation), and
-- counts as the Contact's activity (MKT-CON-004). NULL names keep the
-- recorded ones.
-- name: AddOrgConversationMessage :one
WITH message AS (
    INSERT INTO vetchium.org_conversation_messages (
        message_id, conversation_id, sender_type, sender_user_id,
        sender_display_name, kind, message_text, consumer_domain,
        opening_number
    )
    VALUES (
        sqlc.arg(message_id), sqlc.arg(conversation_id), sqlc.arg(sender_type),
        sqlc.narg(sender_user_id), sqlc.arg(sender_display_name),
        sqlc.arg(kind), sqlc.narg(message_text), sqlc.narg(consumer_domain),
        sqlc.narg(opening_number)
    )
    RETURNING message_id, conversation_id, sender_type, sender_display_name,
        kind, message_text, consumer_domain, opening_number, sent_at
), conversation AS (
    UPDATE vetchium.org_conversations AS c
    SET last_activity_at = message.sent_at,
        recorded_hub_user_name = COALESCE(
            sqlc.narg(hub_user_name)::text, c.recorded_hub_user_name),
        recorded_hub_user_handle = COALESCE(
            sqlc.narg(hub_user_handle)::text, c.recorded_hub_user_handle),
        recorded_agency_name = COALESCE(
            sqlc.narg(agency_name)::text, c.recorded_agency_name),
        recorded_agency_domain = COALESCE(
            sqlc.narg(agency_domain)::text, c.recorded_agency_domain),
        agency_unread_count = CASE message.sender_type
            WHEN 'hub_user' THEN c.agency_unread_count + 1 ELSE 0 END
    FROM message
    WHERE c.conversation_id = message.conversation_id
    RETURNING c.conversation_id, c.contact_id, c.org_did, c.hub_user_did
), contact AS (
    UPDATE vetchium.org_contacts AS t
    SET last_activity_at = message.sent_at
    FROM conversation, message
    WHERE t.contact_id = conversation.contact_id
    RETURNING t.contact_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.conversation.message_sent',
        'org_conversation', conversation.conversation_id::text,
        sqlc.arg(actor_type)::text, sqlc.arg(actor_id)::text,
        conversation.hub_user_did, conversation.org_did, sqlc.arg(source)::text,
        sqlc.narg(idempotency_key),
        jsonb_build_object('message_id', message.message_id::text,
            'kind', message.kind)
    FROM conversation, message
    RETURNING audit_event_id
)
SELECT message.message_id, message.sender_type, message.sender_display_name,
    message.kind, message.message_text, message.consumer_domain,
    message.opening_number, message.sent_at,
    (SELECT count(*) FROM conversation) AS conversation_rows,
    (SELECT count(*) FROM contact) AS contact_rows,
    (SELECT count(*) FROM audit) AS audit_rows
FROM message;

-- The conversation of one of the agency's Contacts, with the Contact's
-- messages setting (MKT-DAT-006).
-- name: GetOrgConversation :one
SELECT c.conversation_id, c.contact_id, c.org_did, c.hub_user_did,
    c.recorded_hub_user_name, c.recorded_hub_user_handle,
    c.recorded_agency_name, c.recorded_agency_domain,
    c.agency_unread_count, c.read_only_reason, c.party_deleted_at,
    c.created_at, c.last_activity_at, t.messages_off
FROM vetchium.org_conversations AS c
JOIN vetchium.org_contacts AS t ON t.contact_id = c.contact_id
WHERE c.org_did = sqlc.arg(org_did) AND c.contact_id = sqlc.arg(contact_id);

-- One page of a conversation's messages, newest first.
-- name: ListOrgConversationMessages :many
SELECT m.message_id, m.sender_type, m.sender_display_name, m.kind,
    m.message_text, m.consumer_domain, m.opening_number, m.sent_at
FROM vetchium.org_conversation_messages AS m
WHERE m.conversation_id = sqlc.arg(conversation_id)
  AND (sqlc.narg(before_sent_at)::timestamptz IS NULL
      OR (m.sent_at, m.message_id) <
          (sqlc.narg(before_sent_at)::timestamptz,
           sqlc.narg(before_message_id)::uuid))
ORDER BY m.sent_at DESC, m.message_id DESC
LIMIT sqlc.arg(page_limit);

-- The distinct Openings the agency suggested in a conversation, each with
-- when it was first suggested.
-- name: ListOrgConversationSuggestions :many
SELECT m.consumer_domain::text AS consumer_domain,
    m.opening_number::integer AS opening_number,
    min(m.sent_at)::timestamptz AS sent_at
FROM vetchium.org_conversation_messages AS m
WHERE m.conversation_id = sqlc.arg(conversation_id) AND m.kind = 'suggestion'
GROUP BY m.consumer_domain, m.opening_number
ORDER BY min(m.sent_at), m.consumer_domain, m.opening_number;

-- Clears the agency's unread count; any agency user's read clears it for all
-- (MKT-DAT-010). No row changes when nothing was unread.
-- name: MarkOrgConversationRead :execrows
WITH updated AS (
    UPDATE vetchium.org_conversations AS c
    SET agency_unread_count = 0
    WHERE c.org_did = sqlc.arg(org_did)
      AND c.contact_id = sqlc.arg(contact_id)
      AND c.agency_unread_count > 0
    RETURNING c.conversation_id, c.contact_id, c.org_did, c.hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.conversation.marked_read',
        'org_conversation', updated.conversation_id::text, 'org_user',
        sqlc.arg(actor_id)::uuid::text, updated.hub_user_did, updated.org_did,
        'orgs-api', jsonb_build_object('contact_id', updated.contact_id::text)
    FROM updated
    RETURNING audit_event_id
)
SELECT updated.conversation_id FROM updated;

-- Deletes the conversation with its messages for both sides, at the Hub
-- user's request (MKT-CNV-007). The Contact and its notes stay.
-- name: DeleteOrgConversationForHubUser :one
WITH deleted AS (
    DELETE FROM vetchium.org_conversations AS c
    WHERE c.org_did = sqlc.arg(org_did)
      AND c.contact_id = sqlc.arg(contact_id)
      AND c.hub_user_did = sqlc.arg(hub_user_did)
    RETURNING c.conversation_id, c.contact_id, c.org_did, c.hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.conversation.deleted', 'org_conversation',
        deleted.conversation_id::text, 'hub_user', deleted.hub_user_did::text,
        deleted.hub_user_did, deleted.org_did, 'federation-command',
        sqlc.arg(idempotency_key),
        jsonb_build_object('contact_id', deleted.contact_id::text,
            'reason', 'hub_user')
    FROM deleted
    RETURNING audit_event_id
)
SELECT deleted.conversation_id, (SELECT count(*) FROM audit) AS audit_rows
FROM deleted;

-- Makes the conversations of a deleted Hub account read-only (MKT-CNV-011),
-- from the deletion notice; the receipt's audit event covers the write.
-- name: MarkOrgConversationsHubUserDeleted :execrows
UPDATE vetchium.org_conversations AS c
SET read_only_reason = 'hub_user_deleted', party_deleted_at = now()
WHERE c.org_did = sqlc.arg(org_did)
  AND c.hub_user_did = sqlc.arg(hub_user_did)
  AND c.party_deleted_at IS NULL;

-- name: ListOrgConversationsDueForRetention :many
SELECT conversation_id, contact_id, org_did
FROM vetchium.org_conversations
WHERE last_activity_at <= now() - interval '365 days'
ORDER BY last_activity_at, conversation_id
LIMIT sqlc.arg(batch_size);

-- name: ListDeletedPartyConversationsDueForRetention :many
SELECT conversation_id, contact_id, org_did
FROM vetchium.org_conversations
WHERE party_deleted_at IS NOT NULL
  AND party_deleted_at <= sqlc.arg(cutoff_party_deleted_at)::timestamptz
ORDER BY party_deleted_at, conversation_id
LIMIT sqlc.arg(batch_size);

-- Deletes one conversation whose retention passed, re-checking the guard the
-- list used (MKT-CNV-009, MKT-CNV-011), so a stale list only costs a no-op.
-- name: RetainOrgConversation :one
WITH deleted AS (
    DELETE FROM vetchium.org_conversations AS c
    WHERE c.conversation_id = sqlc.arg(conversation_id)
      AND (c.last_activity_at <= now() - interval '365 days'
          OR c.party_deleted_at <=
              sqlc.arg(cutoff_party_deleted_at)::timestamptz)
    RETURNING c.conversation_id, c.contact_id, c.org_did, c.hub_user_did,
        c.party_deleted_at IS NOT NULL AS party_deleted
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.conversation.deleted', 'org_conversation',
        deleted.conversation_id::text, 'worker', 'retain-org-contacts',
        deleted.hub_user_did, deleted.org_did, 'workers',
        jsonb_build_object('reason', CASE WHEN deleted.party_deleted
            THEN 'party_deleted' ELSE 'expired' END)
    FROM deleted
    RETURNING audit_event_id
)
SELECT deleted.conversation_id, deleted.contact_id, deleted.org_did,
    deleted.hub_user_did, (SELECT count(*) FROM audit) AS audit_rows
FROM deleted;

-- name: PruneOrgConversationCreations :many
WITH pruned AS (
    DELETE FROM vetchium.org_conversation_creations AS c
    WHERE (c.org_did, c.created_on) IN (
        SELECT s.org_did, s.created_on
        FROM vetchium.org_conversation_creations AS s
        WHERE s.created_on < (now() AT TIME ZONE 'UTC')::date - 1
        ORDER BY s.created_on, s.org_did
        LIMIT sqlc.arg(batch_size)
    )
    RETURNING c.org_did, c.created_on
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.conversation_creations.pruned',
        'org_conversation_creations', pruned.org_did::text, 'worker',
        'retain-org-contacts', pruned.org_did, 'workers',
        jsonb_build_object('action', 'pruned', 'day', pruned.created_on)
    FROM pruned
    RETURNING audit_event_id
)
SELECT pruned.org_did, (SELECT count(*) FROM audit) AS audit_rows
FROM pruned;

-- The agency's name and primary domain, which a conversation records.
-- name: GetAgencyDetails :one
SELECT o.display_name, d.domain::text AS domain
FROM vetchium.orgs AS o
JOIN vetchium.org_domains AS d ON d.org_did = o.org_did
WHERE o.org_did = sqlc.arg(org_did);
