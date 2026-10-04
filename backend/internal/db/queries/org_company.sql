-- Locking the Org row makes the returned state current: after a wait, the
-- update and the result both see the committed row.
-- name: SetOrgCompanyName :one
WITH locked AS (
    SELECT current_org.org_did, current_org.org_state
    FROM vetchium.orgs AS current_org
    WHERE current_org.org_did = sqlc.arg(org_did)
    FOR NO KEY UPDATE
), updated AS (
    UPDATE vetchium.orgs AS o
    SET display_name = sqlc.arg(display_name), updated_at = now()
    FROM locked AS l
    WHERE o.org_did = l.org_did
      AND l.org_state = 'active'
      AND o.display_name IS DISTINCT FROM sqlc.arg(display_name)
    RETURNING o.org_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'org.company.name_changed', 'org',
        u.org_did::text, 'org_user', sqlc.arg(actor_org_user_id)::uuid::text,
        'orgs-api',
        jsonb_build_object('changed_fields', jsonb_build_array('display_name'))
    FROM updated AS u
)
SELECT l.org_state FROM locked AS l;
