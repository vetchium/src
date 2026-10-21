-- name: CountOrgConversationsCreatedOn :one
SELECT COALESCE((
    SELECT c.created
    FROM vetchium.org_conversation_creations AS c
    WHERE c.org_did = sqlc.arg(org_did) AND c.created_on = sqlc.arg(day)::date
), 0)::integer AS created;

-- name: RecordOrgConversationCreation :one
INSERT INTO vetchium.org_conversation_creations (
    org_did, created_on, created
)
VALUES (
    sqlc.arg(org_did), sqlc.arg(day)::date, 1
)
ON CONFLICT (org_did, created_on) DO UPDATE
SET created = vetchium.org_conversation_creations.created + 1
RETURNING created;

-- name: InsertOrgConversation :one
INSERT INTO vetchium.org_conversations (
    conversation_id, contact_id, org_did, hub_user_did,
    recorded_hub_user_name, recorded_hub_user_handle,
    recorded_agency_name, recorded_agency_domain,
    agency_unread, read_only_reason, created_at, last_activity_at
)
VALUES (
    sqlc.arg(conversation_id), sqlc.arg(contact_id), sqlc.arg(org_did), sqlc.arg(hub_user_did),
    sqlc.arg(recorded_hub_user_name), sqlc.arg(recorded_hub_user_handle),
    sqlc.arg(recorded_agency_name), sqlc.arg(recorded_agency_domain),
    sqlc.arg(agency_unread), sqlc.narg(read_only_reason), sqlc.arg(created_at), sqlc.arg(last_activity_at)
)
RETURNING conversation_id, contact_id, org_did, hub_user_did,
    recorded_hub_user_name, recorded_hub_user_handle,
    recorded_agency_name, recorded_agency_domain,
    agency_unread, read_only_reason, party_deleted_at,
    created_at, last_activity_at;

-- name: GetOrgConversationByContact :one
SELECT conversation_id, contact_id, org_did, hub_user_did,
    recorded_hub_user_name, recorded_hub_user_handle,
    recorded_agency_name, recorded_agency_domain,
    agency_unread, read_only_reason, party_deleted_at,
    created_at, last_activity_at
FROM vetchium.org_conversations
WHERE contact_id = sqlc.arg(contact_id);

-- name: GetOrgConversationByAgencyAndUser :one
SELECT conversation_id, contact_id, org_did, hub_user_did,
    recorded_hub_user_name, recorded_hub_user_handle,
    recorded_agency_name, recorded_agency_domain,
    agency_unread, read_only_reason, party_deleted_at,
    created_at, last_activity_at
FROM vetchium.org_conversations
WHERE org_did = sqlc.arg(org_did) AND hub_user_did = sqlc.arg(hub_user_did);

-- name: InsertOrgConversationMessage :one
INSERT INTO vetchium.org_conversation_messages (
    message_id, conversation_id, sender_type, sender_user_id,
    sender_display_name, kind, message_text, consumer_domain,
    opening_number, sent_at
)
VALUES (
    sqlc.arg(message_id), sqlc.arg(conversation_id), sqlc.arg(sender_type), sqlc.narg(sender_user_id),
    sqlc.arg(sender_display_name), sqlc.arg(kind), sqlc.narg(message_text), sqlc.narg(consumer_domain),
    sqlc.narg(opening_number), sqlc.arg(sent_at)
)
RETURNING message_id, conversation_id, sender_type, sender_user_id,
    sender_display_name, kind, message_text, consumer_domain,
    opening_number, sent_at;

-- name: UpdateOrgConversationOnMessage :one
UPDATE vetchium.org_conversations
SET last_activity_at = sqlc.arg(last_activity_at),
    recorded_hub_user_name = sqlc.arg(recorded_hub_user_name),
    recorded_agency_name = sqlc.arg(recorded_agency_name),
    recorded_agency_domain = sqlc.arg(recorded_agency_domain),
    agency_unread = sqlc.arg(agency_unread)
WHERE conversation_id = sqlc.arg(conversation_id)
RETURNING conversation_id, contact_id, org_did, hub_user_did,
    recorded_hub_user_name, recorded_hub_user_handle,
    recorded_agency_name, recorded_agency_domain,
    agency_unread, read_only_reason, party_deleted_at,
    created_at, last_activity_at;

-- name: ListOrgConversationMessages :many
SELECT message_id, conversation_id, sender_type, sender_user_id,
    sender_display_name, kind, message_text, consumer_domain,
    opening_number, sent_at
FROM vetchium.org_conversation_messages
WHERE conversation_id = sqlc.arg(conversation_id)
ORDER BY sent_at ASC, message_id ASC;

-- name: MarkOrgConversationRead :one
UPDATE vetchium.org_conversations
SET agency_unread = false
WHERE contact_id = sqlc.arg(contact_id)
RETURNING conversation_id, contact_id, org_did, hub_user_did,
    recorded_hub_user_name, recorded_hub_user_handle,
    recorded_agency_name, recorded_agency_domain,
    agency_unread, read_only_reason, party_deleted_at,
    created_at, last_activity_at;

-- name: DeleteOrgConversation :execrows
DELETE FROM vetchium.org_conversations
WHERE conversation_id = sqlc.arg(conversation_id);

-- name: DeleteOrgConversationByContact :execrows
DELETE FROM vetchium.org_conversations
WHERE contact_id = sqlc.arg(contact_id);

-- name: SetOrgConversationReadOnlyReason :one
UPDATE vetchium.org_conversations
SET read_only_reason = sqlc.narg(read_only_reason)
WHERE contact_id = sqlc.arg(contact_id)
RETURNING conversation_id, contact_id, org_did, hub_user_did,
    recorded_hub_user_name, recorded_hub_user_handle,
    recorded_agency_name, recorded_agency_domain,
    agency_unread, read_only_reason, party_deleted_at,
    created_at, last_activity_at;

-- name: MarkOrgConversationHubUserDeleted :one
UPDATE vetchium.org_conversations
SET read_only_reason = 'hub_user_deleted',
    party_deleted_at = now()
WHERE hub_user_did = sqlc.arg(hub_user_did)
RETURNING conversation_id, contact_id, org_did, hub_user_did,
    recorded_hub_user_name, recorded_hub_user_handle,
    recorded_agency_name, recorded_agency_domain,
    agency_unread, read_only_reason, party_deleted_at,
    created_at, last_activity_at;

-- name: ListOrgConversationsDueForRetention :many
SELECT conversation_id, contact_id
FROM vetchium.org_conversations
WHERE last_activity_at <= now() - interval '365 days'
ORDER BY last_activity_at, conversation_id
LIMIT sqlc.arg(batch_size);

-- name: ListDeletedPartyConversationsDueForRetention :many
SELECT conversation_id, contact_id
FROM vetchium.org_conversations
WHERE party_deleted_at IS NOT NULL
  AND party_deleted_at <= sqlc.arg(cutoff_party_deleted_at)::timestamptz
ORDER BY party_deleted_at, conversation_id
LIMIT sqlc.arg(batch_size);

-- name: RetainOrgConversation :one
WITH deleted AS (
    DELETE FROM vetchium.org_conversations AS c
    WHERE c.conversation_id = sqlc.arg(conversation_id)
    RETURNING c.conversation_id, c.contact_id, c.org_did, c.hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.conversation.deleted', 'org_conversation',
        deleted.conversation_id::text, 'worker', 'retain-org-contacts',
        deleted.hub_user_did, deleted.org_did, 'workers',
        jsonb_build_object('action', 'deleted', 'reason', sqlc.arg(reason)::text)
    FROM deleted
    RETURNING audit_event_id
)
SELECT deleted.conversation_id, deleted.contact_id, deleted.org_did, deleted.hub_user_did,
    (SELECT count(*) FROM audit) AS audit_rows
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

-- name: InsertAuditEvent :exec
INSERT INTO vetchium.audit_events (
    tenant_id, action, entity_type, entity_id, actor_type, actor_id,
    subject_hub_user_did, subject_org_did, source, idempotency_key, payload
)
VALUES (
    sqlc.arg(tenant_id), sqlc.arg(action), sqlc.arg(entity_type), sqlc.arg(entity_id),
    sqlc.arg(actor_type), sqlc.arg(actor_id), sqlc.narg(subject_hub_user_did),
    sqlc.narg(subject_org_did), sqlc.arg(source), sqlc.narg(idempotency_key),
    sqlc.arg(payload)
);

-- name: GetAgencyDetails :one
SELECT o.display_name, d.domain, o.org_did,
    (SELECT l.object_id::uuid FROM vetchium.org_logo_objects AS l WHERE l.org_did = o.org_did AND l.state = 'active') AS logo_media_id
FROM vetchium.orgs AS o
JOIN vetchium.org_domains AS d ON d.org_did = o.org_did
WHERE o.org_did = sqlc.arg(org_did);

-- name: CheckActiveSourcingEngagement :one
SELECT EXISTS (
    SELECT 1 FROM vetchium.org_engagement_projections
    WHERE provider_org_did = sqlc.arg(provider_org_did)
      AND consumer_domain = sqlc.arg(consumer_domain)
      AND capability_oid = '1.3.6.1.4.1.61453.1.1'
      AND engagement_state = 'active'
) AS is_active;
