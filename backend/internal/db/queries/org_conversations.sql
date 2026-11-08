-- Agency conversations (agent-guides/marketplace.md, Agency conversations).
-- The agency's tenant is authoritative for a conversation and its messages;
-- the Hub user's tenant keeps only the agency pointer. Audit events name a
-- conversation by the Hub user's handle.

-- Creates the conversation of an accepted chat request (MKT-REQ-005); the
-- request counted toward the daily limit when it was sent. The caller holds
-- the Contact lock and found no conversation; the request message and the
-- activity follow (AddOrgConversationMessage, SetConversationActivity).
-- name: CreateOrgConversationFromRequest :one
WITH created AS (
    INSERT INTO vetchium.org_conversations (
        org_did, hub_user_did,
        recorded_hub_user_name, recorded_hub_user_handle,
        recorded_agency_name, recorded_agency_domain
    )
    VALUES (
        sqlc.arg(org_did), sqlc.arg(hub_user_did),
        sqlc.arg(recorded_hub_user_name), sqlc.arg(recorded_hub_user_handle),
        sqlc.arg(recorded_agency_name), sqlc.arg(recorded_agency_domain)
    )
    RETURNING org_did, hub_user_did, recorded_hub_user_handle
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.conversation.created', 'org_conversation',
        created.recorded_hub_user_handle, sqlc.arg(actor_type)::text,
        sqlc.arg(actor_id)::text, created.hub_user_did, created.org_did,
        sqlc.arg(source)::text, sqlc.narg(idempotency_key),
        jsonb_build_object(
            'request_number', sqlc.arg(request_number)::integer)
    FROM created
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM created) AS created_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- Records a side's activity and the Hub tenant's window (MKT-REQ-004). NULL
-- arguments keep what is stored, and activity never moves back. It runs only
-- beside an audited statement of the same operation.
-- name: SetConversationActivity :execrows
UPDATE vetchium.org_conversations AS c
SET hub_activity_at = GREATEST(c.hub_activity_at,
        sqlc.narg(hub_activity_at)::timestamptz),
    agency_activity_at = GREATEST(c.agency_activity_at,
        sqlc.narg(agency_activity_at)::timestamptz),
    window_seconds = COALESCE(sqlc.narg(window_seconds)::bigint,
        c.window_seconds)
WHERE c.org_did = sqlc.arg(org_did)
  AND c.hub_user_did = sqlc.arg(hub_user_did);

-- Appends a message under the conversation's next message number. It
-- records the parties' names as of now (MKT-CNV-001), counts the agency's
-- unread messages (MKT-DAT-010: a Hub user message adds one, an agency
-- message means the agency has read the conversation; an accepted request
-- changes neither), and counts as the Contact's activity (MKT-CON-004). NULL
-- names keep the recorded ones. An accepted request is appended at its
-- earlier sent time (MKT-REQ-005), so activity never moves back.
-- name: AddOrgConversationMessage :one
WITH conversation AS (
    UPDATE vetchium.org_conversations AS c
    SET last_message_number = c.last_message_number + 1,
        last_activity_at = GREATEST(c.last_activity_at,
            COALESCE(sqlc.narg(sent_at)::timestamptz, now())),
        recorded_hub_user_name = COALESCE(
            sqlc.narg(hub_user_name)::text, c.recorded_hub_user_name),
        recorded_hub_user_handle = COALESCE(
            sqlc.narg(hub_user_handle)::text, c.recorded_hub_user_handle),
        recorded_agency_name = COALESCE(
            sqlc.narg(agency_name)::text, c.recorded_agency_name),
        recorded_agency_domain = COALESCE(
            sqlc.narg(agency_domain)::text, c.recorded_agency_domain),
        agency_unread_count = CASE
            WHEN sqlc.arg(kind)::text = 'request' THEN c.agency_unread_count
            WHEN sqlc.arg(sender_type)::text = 'hub_user'
                THEN c.agency_unread_count + 1
            ELSE 0 END
    WHERE c.org_did = sqlc.arg(org_did)
      AND c.hub_user_did = sqlc.arg(hub_user_did)
    RETURNING c.org_did, c.hub_user_did, c.last_message_number,
        c.recorded_hub_user_handle
), message AS (
    INSERT INTO vetchium.org_conversation_messages (
        org_did, hub_user_did, message_number, sender_type, sender_user_id,
        sender_display_name, kind, message_text, consumer_domain,
        opening_number, sent_at
    )
    SELECT conversation.org_did, conversation.hub_user_did,
        conversation.last_message_number, sqlc.arg(sender_type)::text,
        sqlc.narg(sender_user_id)::uuid, sqlc.arg(sender_display_name)::text,
        sqlc.arg(kind)::text, sqlc.narg(message_text)::text,
        sqlc.narg(consumer_domain)::text, sqlc.narg(opening_number)::integer,
        COALESCE(sqlc.narg(sent_at)::timestamptz, now())
    FROM conversation
    RETURNING message_number, sender_type, sender_display_name, kind,
        message_text, consumer_domain, opening_number, sent_at
), contact AS (
    UPDATE vetchium.org_contacts AS t
    SET last_activity_at = GREATEST(t.last_activity_at, message.sent_at)
    FROM message
    WHERE t.org_did = sqlc.arg(org_did)
      AND t.hub_user_did = sqlc.arg(hub_user_did)
    RETURNING t.handle
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.conversation.message_sent',
        'org_conversation', conversation.recorded_hub_user_handle,
        sqlc.arg(actor_type)::text, sqlc.arg(actor_id)::text,
        conversation.hub_user_did, conversation.org_did, sqlc.arg(source)::text,
        sqlc.narg(idempotency_key),
        jsonb_build_object('message_number', message.message_number,
            'kind', message.kind)
    FROM conversation, message
    RETURNING audit_event_id
)
SELECT message.message_number, message.sender_type,
    message.sender_display_name, message.kind, message.message_text,
    message.consumer_domain, message.opening_number, message.sent_at,
    (SELECT count(*) FROM contact) AS contact_rows,
    (SELECT count(*) FROM audit) AS audit_rows
FROM message;

-- The conversation between the agency and a Hub user.
-- name: GetOrgConversation :one
SELECT c.org_did, c.hub_user_did,
    c.recorded_hub_user_name, c.recorded_hub_user_handle,
    c.recorded_agency_name, c.recorded_agency_domain,
    c.agency_unread_count, c.read_only_reason, c.party_deleted_at,
    c.hub_activity_at, c.agency_activity_at, c.window_seconds,
    c.created_at, c.last_activity_at
FROM vetchium.org_conversations AS c
WHERE c.org_did = sqlc.arg(org_did)
  AND c.hub_user_did = sqlc.arg(hub_user_did);

-- One page of a conversation's messages, newest first.
-- name: ListOrgConversationMessages :many
SELECT m.message_number, m.sender_type, m.sender_display_name, m.kind,
    m.message_text, m.consumer_domain, m.opening_number, m.sent_at,
    m.deleted_at
FROM vetchium.org_conversation_messages AS m
WHERE m.org_did = sqlc.arg(org_did)
  AND m.hub_user_did = sqlc.arg(hub_user_did)
  AND (sqlc.narg(before_sent_at)::timestamptz IS NULL
      OR (m.sent_at, m.message_number) <
          (sqlc.narg(before_sent_at)::timestamptz,
           sqlc.narg(before_message_number)::integer))
ORDER BY m.sent_at DESC, m.message_number DESC
LIMIT sqlc.arg(page_limit);

-- name: GetOrgConversationMessage :one
SELECT m.message_number, m.sender_type, m.sender_display_name, m.kind,
    m.message_text, m.consumer_domain, m.opening_number, m.sent_at,
    m.deleted_at
FROM vetchium.org_conversation_messages AS m
WHERE m.org_did = sqlc.arg(org_did)
  AND m.hub_user_did = sqlc.arg(hub_user_did)
  AND m.message_number = sqlc.arg(message_number);

-- Deletes the text of one of the sender's own text messages, leaving a stub
-- (MKT-CNV-007). The audit event keeps the deleted text only when
-- keep_text is set, which the sender's own tenant does; no row changes for
-- another sender's message or one already deleted.
-- name: DeleteOrgConversationMessage :one
WITH target AS (
    SELECT m.message_number, m.message_text
    FROM vetchium.org_conversation_messages AS m
    WHERE m.org_did = sqlc.arg(org_did)
      AND m.hub_user_did = sqlc.arg(hub_user_did)
      AND m.message_number = sqlc.arg(message_number)
      AND m.sender_type = sqlc.arg(sender_type)::text
      AND m.kind = 'text'
      AND m.deleted_at IS NULL
    FOR UPDATE
), deleted AS (
    UPDATE vetchium.org_conversation_messages AS m
    SET message_text = NULL, deleted_at = now()
    FROM target
    WHERE m.org_did = sqlc.arg(org_did)
      AND m.hub_user_did = sqlc.arg(hub_user_did)
      AND m.message_number = target.message_number
    RETURNING m.message_number, m.sender_type, m.sender_display_name,
        m.kind, m.sent_at, m.deleted_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.conversation.message_deleted',
        'org_conversation', c.recorded_hub_user_handle,
        sqlc.arg(actor_type)::text, sqlc.arg(actor_id)::text,
        c.hub_user_did, c.org_did, sqlc.arg(source)::text,
        sqlc.narg(idempotency_key),
        jsonb_strip_nulls(jsonb_build_object(
            'message_number', deleted.message_number,
            'deleted_by', deleted.sender_type,
            'deleted_text', CASE WHEN sqlc.arg(keep_text)::boolean
                THEN target.message_text END))
    FROM deleted, target, vetchium.org_conversations AS c
    WHERE c.org_did = sqlc.arg(org_did)
      AND c.hub_user_did = sqlc.arg(hub_user_did)
    RETURNING audit_event_id
)
SELECT deleted.message_number, deleted.sender_type,
    deleted.sender_display_name, deleted.kind, deleted.sent_at,
    deleted.deleted_at, (SELECT count(*) FROM audit) AS audit_rows
FROM deleted;

-- The distinct Openings the agency suggested in a conversation, each with
-- when it was first suggested; an accepted agency request suggests its
-- Opening (MKT-REQ-005).
-- name: ListOrgConversationSuggestions :many
SELECT m.consumer_domain::text AS consumer_domain,
    m.opening_number::integer AS opening_number,
    min(m.sent_at)::timestamptz AS sent_at
FROM vetchium.org_conversation_messages AS m
WHERE m.org_did = sqlc.arg(org_did)
  AND m.hub_user_did = sqlc.arg(hub_user_did)
  AND (m.kind = 'suggestion'
      OR (m.kind = 'request' AND m.sender_type = 'agency'))
GROUP BY m.consumer_domain, m.opening_number
ORDER BY min(m.sent_at), m.consumer_domain, m.opening_number;

-- Clears the agency's unread count; any agency user's read clears it for all
-- (MKT-DAT-010). No row changes when nothing was unread.
-- name: MarkOrgConversationRead :execrows
WITH updated AS (
    UPDATE vetchium.org_conversations AS c
    SET agency_unread_count = 0
    WHERE c.org_did = sqlc.arg(org_did)
      AND c.hub_user_did = sqlc.arg(hub_user_did)
      AND c.agency_unread_count > 0
    RETURNING c.org_did, c.hub_user_did, c.recorded_hub_user_handle
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.conversation.marked_read',
        'org_conversation', updated.recorded_hub_user_handle, 'org_user',
        sqlc.arg(actor_id)::uuid::text, updated.hub_user_did, updated.org_did,
        'orgs-api', jsonb_build_object('action', 'marked_read')
    FROM updated
    RETURNING audit_event_id
)
SELECT updated.hub_user_did FROM updated;

-- Makes the conversations of a deleted Hub account read-only (MKT-CNV-011),
-- from the deletion notice; the receipt's audit event covers the write.
-- name: MarkOrgConversationsHubUserDeleted :execrows
UPDATE vetchium.org_conversations AS c
SET read_only_reason = 'hub_user_deleted', party_deleted_at = now()
WHERE c.org_did = sqlc.arg(org_did)
  AND c.hub_user_did = sqlc.arg(hub_user_did)
  AND c.party_deleted_at IS NULL;

-- name: ListOrgConversationsDueForRetention :many
SELECT org_did, hub_user_did
FROM vetchium.org_conversations
WHERE last_activity_at <= now() - interval '365 days'
ORDER BY last_activity_at, org_did, hub_user_did
LIMIT sqlc.arg(batch_size);

-- name: ListDeletedPartyConversationsDueForRetention :many
SELECT org_did, hub_user_did
FROM vetchium.org_conversations
WHERE party_deleted_at IS NOT NULL
  AND party_deleted_at <= sqlc.arg(cutoff_party_deleted_at)::timestamptz
ORDER BY party_deleted_at, org_did, hub_user_did
LIMIT sqlc.arg(batch_size);

-- Deletes one conversation whose retention passed, re-checking the guard the
-- list used (MKT-CNV-009, MKT-CNV-011), so a stale list only costs a no-op.
-- name: RetainOrgConversation :one
WITH deleted AS (
    DELETE FROM vetchium.org_conversations AS c
    WHERE c.org_did = sqlc.arg(org_did)
      AND c.hub_user_did = sqlc.arg(hub_user_did)
      AND (c.last_activity_at <= now() - interval '365 days'
          OR c.party_deleted_at <=
              sqlc.arg(cutoff_party_deleted_at)::timestamptz)
    RETURNING c.org_did, c.hub_user_did, c.recorded_hub_user_handle,
        c.party_deleted_at IS NOT NULL AS party_deleted
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.conversation.deleted', 'org_conversation',
        deleted.recorded_hub_user_handle, 'worker', 'retain-org-contacts',
        deleted.hub_user_did, deleted.org_did, 'workers',
        jsonb_build_object('reason', CASE WHEN deleted.party_deleted
            THEN 'party_deleted' ELSE 'expired' END)
    FROM deleted
    RETURNING audit_event_id
)
SELECT deleted.org_did, deleted.hub_user_did,
    (SELECT count(*) FROM audit) AS audit_rows
FROM deleted;

-- The agency's name and primary domain, which a conversation records.
-- name: GetAgencyDetails :one
SELECT o.display_name, d.domain::text AS domain
FROM vetchium.orgs AS o
JOIN vetchium.org_domains AS d ON d.org_did = o.org_did
WHERE o.org_did = sqlc.arg(org_did);
