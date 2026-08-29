-- name: ListAdminUsers :many
SELECT
    u.admin_user_id,
    u.email_address,
    u.display_name,
    u.admin_user_state,
    auth.permissions::text[] AS permissions,
    u.totp_enabled,
    u.last_login_at,
    u.created_at
FROM vetchium.admin_users AS u
CROSS JOIN LATERAL (
    SELECT ARRAY(
        SELECT e.permission
        FROM vetchium.admin_effective_permissions AS e
        WHERE e.admin_user_id = u.admin_user_id
        ORDER BY e.permission
    )::text[] AS permissions
) AS auth
WHERE (
        sqlc.narg(filter_search)::text IS NULL OR
        u.email_address ILIKE '%' || sqlc.narg(filter_search)::text || '%' OR
        u.display_name ILIKE '%' || sqlc.narg(filter_search)::text || '%'
    )
  AND (
        sqlc.narg(filter_state)::vetchium.admin_user_state IS NULL OR
        u.admin_user_state = sqlc.narg(filter_state)::vetchium.admin_user_state
    )
  AND (
        sqlc.narg(filter_permissions)::text[] IS NULL OR
        auth.permissions @> sqlc.narg(filter_permissions)::text[]
    )
  AND (
        NOT coalesce(sqlc.narg(filter_no_permissions)::boolean, false) OR
        cardinality(auth.permissions) = 0
    )
  AND (
        sqlc.narg(filter_totp_enabled)::boolean IS NULL OR
        u.totp_enabled = sqlc.narg(filter_totp_enabled)::boolean
    )
  AND (
        sqlc.narg(filter_last_login)::text IS NULL OR
        sqlc.narg(filter_last_login)::text = 'never' AND
            u.last_login_at IS NULL OR
        sqlc.narg(filter_last_login)::text = 'inactive_30_days' AND
            u.last_login_at < now() - interval '30 days' OR
        sqlc.narg(filter_last_login)::text = 'inactive_90_days' AND
            u.last_login_at < now() - interval '90 days'
    )
  AND (
        sqlc.narg(before_created_at)::timestamptz IS NULL OR
        (u.created_at, u.admin_user_id) < (
            sqlc.narg(before_created_at)::timestamptz,
            sqlc.narg(before_admin_user_id)::uuid
        )
    )
ORDER BY u.created_at DESC, u.admin_user_id DESC
LIMIT sqlc.arg(page_limit);

-- name: DisableAdminUser :one
-- The update refuses to leave a tenant without an active administrator able to
-- manage administrators, the state no remaining principal could undo. The
-- caller holding that permission is normally the one who satisfies the
-- predicate, so this stops a lockout reached any other way.
WITH target AS (
    SELECT u.admin_user_id
    FROM vetchium.admin_users AS u
    WHERE u.admin_user_id = sqlc.arg(target_admin_user_id)::uuid
), updated AS (
    UPDATE vetchium.admin_users
    SET admin_user_state = 'disabled',
        updated_at = now()
    WHERE admin_user_id = sqlc.arg(target_admin_user_id)::uuid
      AND admin_user_id <> sqlc.arg(actor_admin_user_id)::uuid
      AND EXISTS (
            SELECT 1
            FROM vetchium.admin_effective_permissions AS e
            JOIN vetchium.admin_users AS remaining USING (admin_user_id)
            WHERE e.permission = 'admin:manage_users'
              AND remaining.admin_user_state = 'active'
              AND remaining.admin_user_id <>
                  sqlc.arg(target_admin_user_id)::uuid
        )
    RETURNING admin_user_id
), sessions AS (
    DELETE FROM vetchium.admin_sessions
    WHERE admin_user_id IN (SELECT admin_user_id FROM updated)
), challenges AS (
    UPDATE vetchium.admin_login_challenges
    SET active = false
    WHERE admin_user_id IN (SELECT admin_user_id FROM updated)
      AND active
), resets AS (
    UPDATE vetchium.admin_password_reset_tokens
    SET active = false
    WHERE admin_user_id IN (SELECT admin_user_id FROM updated)
      AND active
), enrollments AS (
    UPDATE vetchium.admin_totp_enrollments
    SET active = false
    WHERE admin_user_id IN (SELECT admin_user_id FROM updated)
      AND active
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.user.disabled',
        'admin_user',
        admin_user_id::text,
        'admin',
        sqlc.arg(actor_admin_user_id)::uuid::text,
        'admin-api',
        jsonb_build_object(
            'state', 'disabled',
            'sessions_revoked', true
        )
    FROM updated
)
SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'not_found'
    WHEN sqlc.arg(target_admin_user_id)::uuid =
        sqlc.arg(actor_admin_user_id)::uuid THEN 'self'
    WHEN NOT EXISTS (SELECT 1 FROM updated) THEN 'last_manager'
    ELSE 'ok'
END::text AS result;

-- name: EnableAdminUser :one
WITH target AS (
    SELECT u.admin_user_id
    FROM vetchium.admin_users AS u
    WHERE u.admin_user_id = sqlc.arg(target_admin_user_id)
), updated AS (
    UPDATE vetchium.admin_users
    SET admin_user_state = 'active',
        updated_at = now()
    WHERE admin_user_id = sqlc.arg(target_admin_user_id)
    RETURNING admin_user_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.user.enabled',
        'admin_user',
        admin_user_id::text,
        'admin',
        sqlc.arg(actor_admin_user_id)::uuid::text,
        'admin-api',
        jsonb_build_object('state', 'active')
    FROM updated
)
SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'not_found'
    ELSE 'ok'
END::text AS result;
