-- name: GetOrgSubscription :one
SELECT
    o.org_plan_oid, o.org_billing_interval, o.org_state,
    o.google_sign_in_enabled,
    vetchium.org_seats_in_use(o.org_did)::bigint AS seats_in_use
FROM vetchium.orgs AS o
WHERE o.org_did = sqlc.arg(org_did);

-- Lock first, then read seats in a new statement snapshot.
-- name: LockOrgForBilling :one
SELECT org_did
FROM vetchium.orgs
WHERE org_did = sqlc.arg(org_did)
FOR UPDATE;

-- name: SaveOrgSubscription :exec
WITH previous AS (
    SELECT o.org_plan_oid, o.org_billing_interval, o.google_sign_in_enabled
    FROM vetchium.orgs AS o
    WHERE o.org_did = sqlc.arg(org_did)
), updated AS (
    UPDATE vetchium.orgs AS o
    SET
        org_plan_oid = sqlc.arg(org_plan_oid),
        org_billing_interval = sqlc.narg(org_billing_interval),
        google_sign_in_enabled = o.google_sign_in_enabled
            AND sqlc.arg(org_plan_oid)::text
                = ANY(sqlc.arg(google_sign_in_plan_oids)::text[]),
        updated_at = now()
    WHERE o.org_did = sqlc.arg(org_did)
    RETURNING o.org_did, o.org_billing_interval
), logos_queued AS (
    -- A plan that does not include the logo takes it away in this same
    -- transaction; the object bytes are removed by a retried worker task.
    UPDATE vetchium.org_logo_objects AS l
    SET state = 'pending_delete', upload_expires_at = NULL,
        delete_requested_at = now(),
        next_attempt_at = now() + interval '1 minute'
    WHERE l.org_did = sqlc.arg(org_did)
      AND l.state IN ('active', 'uploading')
      AND NOT (sqlc.arg(org_plan_oid) = ANY(sqlc.arg(logo_plan_oids)::text[]))
    RETURNING l.object_id
), logo_audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'org.logo.removed_by_plan', 'org_logo',
        q.object_id::text, 'org_user', sqlc.arg(actor_org_user_id)::uuid::text,
        'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('org_plan_oid', sqlc.arg(org_plan_oid)::text)
    FROM logos_queued AS q
    RETURNING audit_event_id
), google_audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'org.google_sign_in.disabled_by_plan', 'org',
        sqlc.arg(org_did)::text, 'org_user',
        sqlc.arg(actor_org_user_id)::uuid::text,
        'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('org_plan_oid', sqlc.arg(org_plan_oid)::text)
    FROM previous AS p
    WHERE p.google_sign_in_enabled
      AND NOT (sqlc.arg(org_plan_oid)::text
          = ANY(sqlc.arg(google_sign_in_plan_oids)::text[]))
    RETURNING audit_event_id
)
INSERT INTO vetchium.audit_events (
    tenant_id, action, entity_type, entity_id, actor_type, actor_id,
    source, idempotency_key, payload
)
SELECT
    sqlc.arg(tenant_id), 'org.subscription.changed', 'org',
    u.org_did::text, 'org_user', sqlc.arg(actor_org_user_id)::uuid::text,
    'orgs-api', sqlc.arg(idempotency_key),
    jsonb_build_object(
        'before_plan', p.org_plan_oid,
        'before_interval', p.org_billing_interval,
        'plan', sqlc.arg(org_plan_oid)::text,
        'interval', u.org_billing_interval
    )
FROM updated AS u
CROSS JOIN previous AS p;

-- name: GetOrgSeatsInUse :one
SELECT vetchium.org_seats_in_use(sqlc.arg(org_did))::bigint AS seats_in_use;
