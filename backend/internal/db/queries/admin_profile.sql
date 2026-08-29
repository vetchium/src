-- name: SetAdminPreferredLanguage :one
WITH updated AS (
    UPDATE vetchium.admin_users AS u
    SET preferred_language = sqlc.arg(preferred_language),
        updated_at = now()
    WHERE admin_user_id = sqlc.arg(admin_user_id)
      AND admin_user_state = 'active'
    RETURNING admin_user_id, preferred_language
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.profile.preferred-language-set',
        'admin_user',
        admin_user_id::text,
        'admin',
        admin_user_id::text,
        'admin-api',
        jsonb_build_object('preferred_language', preferred_language)
    FROM updated
)
SELECT count(*)::bigint FROM updated;

-- name: SetAdminDisplayName :one
WITH updated AS (
    UPDATE vetchium.admin_users AS u
    SET display_name = sqlc.arg(display_name),
        updated_at = now()
    WHERE u.admin_user_id = sqlc.arg(target_admin_user_id)
      AND u.admin_user_state = 'active'
    RETURNING admin_user_id, display_name
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.profile.display-name-set',
        'admin_user',
        admin_user_id::text,
        'admin',
        admin_user_id::text,
        'admin-api',
        jsonb_build_object('display_name_changed', true)
    FROM updated
)
SELECT count(*)::bigint FROM updated;
