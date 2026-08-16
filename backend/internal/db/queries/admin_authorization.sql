-- name: SetAdminPermissions :one
WITH target AS (
    SELECT u.admin_user_id
    FROM vetchium.admin_users AS u
    WHERE u.admin_user_id = sqlc.arg(target_admin_user_id)
), deleted AS (
    DELETE FROM vetchium.admin_permissions
    WHERE admin_user_id IN (SELECT admin_user_id FROM target)
), inserted AS (
    INSERT INTO vetchium.admin_permissions (admin_user_id, permission)
    SELECT target.admin_user_id, requested.permission
    FROM target
    CROSS JOIN unnest(sqlc.arg(permissions)::text[]) AS requested(permission)
    RETURNING admin_user_id
)
SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'not_found'
    ELSE 'ok'
END::text AS result;
