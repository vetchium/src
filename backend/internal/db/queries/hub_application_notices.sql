-- Takes the oldest notice off the queue and returns it with its recipient.
-- The caller runs QueueHubApplicationEmail in the same transaction, so a
-- failure puts the notice back. A recipient who is no longer active still
-- consumes the notice; the caller drops it.
-- name: ClaimHubApplicationNotice :one
WITH candidate AS (
    SELECT notice_id
    FROM vetchium.hub_application_notices
    ORDER BY created_at, notice_id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
), claimed AS (
    DELETE FROM vetchium.hub_application_notices AS n
    USING candidate
    WHERE n.notice_id = candidate.notice_id
    RETURNING n.notice_id, n.hub_user_did, n.notice, n.org_display_name,
        n.opening_title
)
SELECT claimed.notice_id, claimed.hub_user_did, claimed.notice, claimed.org_display_name,
    claimed.opening_title, u.email_address, u.display_name,
    u.preferred_language, u.hub_user_state
FROM claimed
JOIN vetchium.hub_users AS u ON u.hub_user_did = claimed.hub_user_did;

-- The audit event names the notice and email kind, never an address or text.
-- name: QueueHubApplicationEmail :one
WITH outbox AS (
    INSERT INTO vetchium.hub_email_outbox (
        kind, recipient_email_address, preferred_language, payload_ciphertext
    )
    VALUES (
        sqlc.arg(kind), sqlc.arg(recipient_email_address),
        sqlc.arg(preferred_language), sqlc.arg(payload_ciphertext)
    )
    RETURNING hub_email_outbox_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.application.notice-queued',
        'hub_user', sqlc.arg(hub_user_did)::text, 'worker',
        'application-notice', 'workers',
        jsonb_build_object('kind', sqlc.arg(kind)::text)
    FROM outbox
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM audit) AS audit_rows;

-- A dropped notice is still audited.
-- name: AuditDroppedHubApplicationNotice :exec
INSERT INTO vetchium.audit_events (
    tenant_id, action, entity_type, entity_id, actor_type, actor_id, source,
    payload
)
VALUES (
    sqlc.arg(tenant_id), 'hub.application.notice-dropped',
    'hub_user', sqlc.arg(hub_user_did)::text, 'worker',
    'application-notice', 'workers',
    jsonb_build_object('reason', 'recipient-not-active')
);
