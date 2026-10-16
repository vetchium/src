-- Locking the Org row makes the returned state current: after a wait, the
-- update and the result both see the committed row.
-- name: SetOrgCompanyDetails :one
WITH locked AS (
    SELECT
        current_org.org_did, current_org.org_state, current_org.display_name,
        current_org.country, current_org.default_language
    FROM vetchium.orgs AS current_org
    WHERE current_org.org_did = sqlc.arg(org_did)
    FOR NO KEY UPDATE
), changed AS (
    SELECT
        l.org_did,
        l.display_name IS DISTINCT FROM sqlc.arg(display_name)::text
            AS name_changed,
        l.country IS DISTINCT FROM sqlc.arg(country)::text AS country_changed,
        l.default_language::text
            IS DISTINCT FROM sqlc.arg(default_language)::text
            AS language_changed
    FROM locked AS l
    WHERE l.org_state = 'active'
), updated AS (
    UPDATE vetchium.orgs AS o
    SET display_name = sqlc.arg(display_name),
        country = sqlc.arg(country),
        default_language = sqlc.arg(default_language),
        updated_at = now()
    FROM changed AS c
    WHERE o.org_did = c.org_did
      AND (c.name_changed OR c.country_changed OR c.language_changed)
    RETURNING o.org_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'org.company.details_changed', 'org',
        u.org_did::text, 'org_user', sqlc.arg(actor_org_user_id)::uuid::text,
        'orgs-api',
        jsonb_build_object(
            'changed_fields',
            CASE WHEN c.name_changed
                THEN '["display_name"]'::jsonb ELSE '[]'::jsonb END
            || CASE WHEN c.country_changed
                THEN '["country"]'::jsonb ELSE '[]'::jsonb END
            || CASE WHEN c.language_changed
                THEN '["default_language"]'::jsonb ELSE '[]'::jsonb END
        )
    FROM updated AS u
    JOIN changed AS c ON c.org_did = u.org_did
)
SELECT l.org_state FROM locked AS l;
