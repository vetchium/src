-- name: LockAdminSuperadminInvariant :exec
SELECT pg_advisory_xact_lock(
    hashtextextended('vetchium-admin-active-superadmin-invariant', 0)
);

-- name: GrantAdminPermission :one
WITH target AS (
    SELECT u.admin_user_id, u.is_superadmin
    FROM vetchium.admin_users AS u
    WHERE u.admin_user_id = sqlc.arg(target_admin_user_id)
), requested_permissions AS (
    SELECT unnest(
        CASE sqlc.arg(permission)::text
            WHEN 'admin:manage_users' THEN ARRAY[
                'admin:view_users',
                'admin:manage_users'
            ]::text[]
            ELSE ARRAY[sqlc.arg(permission)::text]
        END
    ) AS permission
), inserted AS (
    INSERT INTO vetchium.admin_permissions (admin_user_id, permission)
    SELECT target.admin_user_id, requested_permissions.permission
    FROM target
    CROSS JOIN requested_permissions
    WHERE NOT target.is_superadmin
    ON CONFLICT DO NOTHING
    RETURNING admin_user_id
)
SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'not_found'
    ELSE 'ok'
END::text AS result;

-- name: RevokeAdminPermission :one
WITH target AS (
    SELECT u.admin_user_id, u.is_superadmin
    FROM vetchium.admin_users AS u
    WHERE u.admin_user_id = sqlc.arg(target_admin_user_id)
), dependency AS (
    SELECT 1
    FROM vetchium.admin_permissions
    WHERE admin_user_id = sqlc.arg(target_admin_user_id)
      AND permission = 'admin:manage_users'
      AND sqlc.arg(permission)::text = 'admin:view_users'
), deleted AS (
    DELETE FROM vetchium.admin_permissions
    WHERE admin_user_id = sqlc.arg(target_admin_user_id)
      AND permission = sqlc.arg(permission)
      AND NOT EXISTS (SELECT 1 FROM dependency)
      AND EXISTS (SELECT 1 FROM target WHERE NOT is_superadmin)
)
SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'not_found'
    WHEN EXISTS (SELECT 1 FROM target WHERE is_superadmin) THEN 'not_applicable'
    WHEN EXISTS (SELECT 1 FROM dependency) THEN 'dependency'
    ELSE 'ok'
END::text AS result;

-- name: PromoteAdminToSuperadmin :one
WITH target AS (
    UPDATE vetchium.admin_users AS u
    SET is_superadmin = true,
        updated_at = now()
    WHERE u.admin_user_id = sqlc.arg(target_admin_user_id)
    RETURNING u.admin_user_id
), permissions AS (
    DELETE FROM vetchium.admin_permissions
    WHERE admin_user_id IN (SELECT admin_user_id FROM target)
), sessions AS (
    DELETE FROM vetchium.admin_sessions
    WHERE admin_user_id IN (SELECT admin_user_id FROM target)
), challenges AS (
    UPDATE vetchium.admin_login_challenges
    SET active = false
    WHERE admin_user_id IN (SELECT admin_user_id FROM target)
      AND active
)
SELECT CASE
    WHEN EXISTS (SELECT 1 FROM target) THEN 'ok'
    ELSE 'not_found'
END::text AS result;

-- name: DemoteAdminFromSuperadmin :one
WITH target AS (
    SELECT u.admin_user_id, u.is_superadmin, u.admin_user_state
    FROM vetchium.admin_users AS u
    WHERE u.admin_user_id = sqlc.arg(target_admin_user_id)
    FOR UPDATE
), active_superadmins AS (
    SELECT count(*)::bigint AS count
    FROM vetchium.admin_users
    WHERE is_superadmin
      AND admin_user_state = 'active'
), updated AS (
    UPDATE vetchium.admin_users
    SET is_superadmin = false,
        updated_at = now()
    WHERE admin_user_id = sqlc.arg(target_admin_user_id)
      AND sqlc.arg(target_admin_user_id) <> sqlc.arg(actor_admin_user_id)
      AND (
          NOT EXISTS (
              SELECT 1 FROM target
              WHERE is_superadmin AND admin_user_state = 'active'
          ) OR (SELECT count FROM active_superadmins) > 1
      )
    RETURNING admin_user_id
), permissions AS (
    DELETE FROM vetchium.admin_permissions
    WHERE admin_user_id IN (SELECT admin_user_id FROM updated)
), sessions AS (
    DELETE FROM vetchium.admin_sessions
    WHERE admin_user_id IN (SELECT admin_user_id FROM updated)
), challenges AS (
    UPDATE vetchium.admin_login_challenges
    SET active = false
    WHERE admin_user_id IN (SELECT admin_user_id FROM updated)
      AND active
)
SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'not_found'
    WHEN sqlc.arg(target_admin_user_id) = sqlc.arg(actor_admin_user_id) THEN 'self'
    WHEN EXISTS (
        SELECT 1 FROM target
        WHERE is_superadmin AND admin_user_state = 'active'
    ) AND (SELECT count FROM active_superadmins) <= 1 THEN 'last_superadmin'
    ELSE 'ok'
END::text AS result;
