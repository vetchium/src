-- name: ExpireOrgOpenings :one
WITH due AS (
    SELECT org_opening_id
    FROM vetchium.org_openings
    WHERE opening_state IN ('published', 'paused')
      AND expires_at <= now()
    ORDER BY expires_at, org_opening_id
    LIMIT 100
    FOR UPDATE SKIP LOCKED
), expired AS (
    UPDATE vetchium.org_openings AS o
    SET opening_state = 'expired', ended_at = now(), updated_at = now(),
        version = o.version + 1
    FROM due
    WHERE o.org_opening_id = due.org_opening_id
      AND o.opening_state IN ('published', 'paused')
      AND o.expires_at <= now()
    RETURNING o.org_opening_id, o.org_did, o.opening_number, o.version
), removed_working AS (
    DELETE FROM vetchium.org_opening_contents AS c
    USING expired
    WHERE c.org_opening_id = expired.org_opening_id AND c.slot = 'working'
    RETURNING c.org_opening_id
), cancelled AS (
    UPDATE vetchium.org_opening_requests AS r
    SET request_state = 'cancelled', decided_at = now()
    FROM expired
    WHERE r.org_opening_id = expired.org_opening_id
      AND r.request_state = 'pending'
    RETURNING r.org_opening_id, r.org_opening_request_id, r.request_kind
), expired_history AS (
    INSERT INTO vetchium.org_opening_history (
        org_opening_history_id, org_opening_id, action, opening_version
    )
    SELECT gen_random_uuid(), expired.org_opening_id, 'expired',
        expired.version
    FROM expired
    RETURNING org_opening_id
), cancelled_history AS (
    INSERT INTO vetchium.org_opening_history (
        org_opening_history_id, org_opening_id, action,
        org_opening_request_id, request_kind, request_state, opening_version
    )
    SELECT gen_random_uuid(), cancelled.org_opening_id, 'cancelled',
        cancelled.org_opening_request_id, cancelled.request_kind,
        'cancelled', expired.version
    FROM cancelled JOIN expired USING (org_opening_id)
    RETURNING org_opening_id
), expired_audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.opening.expired', 'org_opening',
        expired.org_did::text || ':' || expired.opening_number::text,
        'worker', 'opening-expiry', 'workers',
        jsonb_build_object('opening_number', expired.opening_number,
            'action', 'expired', 'version', expired.version)
    FROM expired
    RETURNING audit_event_id
), cancelled_audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.opening.cancelled', 'org_opening',
        expired.org_did::text || ':' || expired.opening_number::text,
        'worker', 'opening-expiry', 'workers',
        jsonb_build_object('opening_number', expired.opening_number,
            'action', 'cancelled', 'request_kind', cancelled.request_kind,
            'outcome', 'cancelled', 'version', expired.version)
    FROM cancelled JOIN expired USING (org_opening_id)
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM expired)::integer AS expired_count,
    (SELECT count(*) FROM removed_working)::integer AS removed_working_count,
    (SELECT count(*) FROM cancelled)::integer AS cancelled_count,
    (SELECT count(*) FROM expired_history)::integer AS expired_history_count,
    (SELECT count(*) FROM cancelled_history)::integer AS cancelled_history_count,
    (SELECT count(*) FROM expired_audit)::integer AS expired_audit_count,
    (SELECT count(*) FROM cancelled_audit)::integer AS cancelled_audit_count;
