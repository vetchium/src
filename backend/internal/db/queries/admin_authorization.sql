-- name: SetAdminPermissions :one
-- Refused when the replacement would remove the last active administrator
-- able to manage administrators, which no remaining principal could undo. A
-- tenant that already has none is not held to the invariant it has lost.
WITH target AS (
    SELECT u.admin_user_id, u.admin_user_state
    FROM vetchium.admin_users AS u
    WHERE u.admin_user_id = sqlc.arg(target_admin_user_id)
), managers AS (
    SELECT u.admin_user_id
    FROM vetchium.admin_effective_permissions AS e
    JOIN vetchium.admin_users AS u USING (admin_user_id)
    WHERE e.permission = 'admin:manage_users'
      AND u.admin_user_state = 'active'
), permitted AS (
    SELECT t.admin_user_id
    FROM target AS t
    WHERE EXISTS (
            SELECT 1
            FROM managers
            WHERE managers.admin_user_id <> t.admin_user_id
        )
       OR t.admin_user_state = 'active' AND
            'admin:manage_users' = ANY(sqlc.arg(permissions)::text[])
       OR NOT EXISTS (SELECT 1 FROM managers)
), deleted AS (
    DELETE FROM vetchium.admin_permissions
    WHERE admin_user_id IN (SELECT admin_user_id FROM permitted)
), inserted AS (
    INSERT INTO vetchium.admin_permissions (admin_user_id, permission)
    SELECT permitted.admin_user_id, requested.permission
    FROM permitted
    CROSS JOIN unnest(sqlc.arg(permissions)::text[]) AS requested(permission)
    RETURNING admin_user_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.permissions.set',
        'admin_user',
        admin_user_id::text,
        'admin',
        sqlc.arg(actor_admin_user_id)::uuid::text,
        'admin-api',
        jsonb_build_object(
            'permissions', to_jsonb(sqlc.arg(permissions)::text[])
        )
    FROM permitted
)
SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'not_found'
    WHEN NOT EXISTS (SELECT 1 FROM permitted) THEN 'last_manager'
    ELSE 'ok'
END::text AS result;
