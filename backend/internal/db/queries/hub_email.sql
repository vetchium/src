-- name: ClaimHubEmail :one
WITH candidate AS (
    SELECT hub_email_outbox_id
    FROM vetchium.hub_email_outbox
    WHERE sent_at IS NULL
      AND failed_at IS NULL
      AND next_attempt_at <= now()
      AND (leased_until IS NULL OR leased_until <= now())
    ORDER BY created_at, hub_email_outbox_id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
), claimed AS (
    UPDATE vetchium.hub_email_outbox
    SET lease_token = sqlc.arg(lease_token),
        leased_until = sqlc.arg(leased_until),
        attempt_count = attempt_count + 1
    WHERE hub_email_outbox_id = (
        SELECT hub_email_outbox_id FROM candidate
    )
    RETURNING hub_email_outbox_id, kind, recipient_email_address,
        preferred_language, payload_ciphertext, attempt_count
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.email.delivery-claimed',
        'hub_email',
        hub_email_outbox_id::text,
        'worker',
        'email-delivery',
        'workers',
        jsonb_build_object('attempt', attempt_count)
    FROM claimed
)
SELECT
    hub_email_outbox_id,
    kind,
    recipient_email_address,
    preferred_language,
    payload_ciphertext,
    attempt_count
FROM claimed;

-- name: MarkHubEmailSent :one
WITH updated AS (
    UPDATE vetchium.hub_email_outbox
    SET sent_at = now(),
        lease_token = NULL,
        leased_until = NULL
    WHERE hub_email_outbox_id = sqlc.arg(hub_email_outbox_id)
      AND lease_token = sqlc.arg(lease_token)
      AND sent_at IS NULL
      AND failed_at IS NULL
    RETURNING hub_email_outbox_id, attempt_count
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.email.sent',
        'hub_email',
        hub_email_outbox_id::text,
        'worker',
        'email-delivery',
        'workers',
        jsonb_build_object('attempt', attempt_count)
    FROM updated
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS marked;

-- name: ScheduleHubEmailRetry :one
WITH updated AS (
    UPDATE vetchium.hub_email_outbox
    SET next_attempt_at = sqlc.arg(next_attempt_at),
        lease_token = NULL,
        leased_until = NULL
    WHERE hub_email_outbox_id = sqlc.arg(hub_email_outbox_id)
      AND lease_token = sqlc.arg(lease_token)
      AND sent_at IS NULL
      AND failed_at IS NULL
    RETURNING hub_email_outbox_id, attempt_count
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.email.retry-scheduled',
        'hub_email',
        hub_email_outbox_id::text,
        'worker',
        'email-delivery',
        'workers',
        jsonb_build_object('attempt', attempt_count)
    FROM updated
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS marked;

-- name: MarkHubEmailFailed :one
WITH updated AS (
    UPDATE vetchium.hub_email_outbox
    SET failed_at = now(),
        lease_token = NULL,
        leased_until = NULL
    WHERE hub_email_outbox_id = sqlc.arg(hub_email_outbox_id)
      AND lease_token = sqlc.arg(lease_token)
      AND sent_at IS NULL
      AND failed_at IS NULL
    RETURNING hub_email_outbox_id, attempt_count
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.email.failed',
        'hub_email',
        hub_email_outbox_id::text,
        'worker',
        'email-delivery',
        'workers',
        jsonb_build_object('attempt', attempt_count)
    FROM updated
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS marked;
