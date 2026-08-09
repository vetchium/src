-- name: ListAdminUsers :many
SELECT
    u.admin_user_id,
    u.email_address,
    names.display_names::text AS display_names_json,
    u.primary_display_name_language,
    u.admin_user_state,
    u.is_superadmin,
    (CASE
        WHEN u.is_superadmin THEN ARRAY[
            'admin:view_users',
            'admin:manage_users'
        ]::text[]
        ELSE auth.permissions
    END)::text[] AS permissions,
    u.totp_enabled,
    u.last_login_at,
    u.created_at
FROM vetchium.admin_users AS u
CROSS JOIN LATERAL (
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'language_code', d.language_code,
                'display_name', d.display_name
            ) ORDER BY d.language_code
        ),
        '[]'::jsonb
    ) AS display_names
    FROM vetchium.admin_display_names AS d
    WHERE d.admin_user_id = u.admin_user_id
) AS names
CROSS JOIN LATERAL (
    SELECT ARRAY(
        SELECT permission
        FROM (
            SELECT p.permission
            FROM vetchium.admin_permissions AS p
            WHERE p.admin_user_id = u.admin_user_id
            UNION
            SELECT 'admin:view_users'
            FROM vetchium.admin_permissions AS p
            WHERE p.admin_user_id = u.admin_user_id
              AND p.permission = 'admin:manage_users'
        ) AS effective_permissions
        ORDER BY permission
    )::text[] AS permissions
) AS auth
WHERE (
        sqlc.narg(filter_email_address)::text IS NULL OR
        u.email_address ILIKE '%' || sqlc.narg(filter_email_address)::text || '%'
    )
  AND (
        sqlc.narg(filter_display_name)::text IS NULL OR
        EXISTS (
            SELECT 1
            FROM vetchium.admin_display_names AS d
            WHERE d.admin_user_id = u.admin_user_id
              AND d.display_name ILIKE
                  '%' || sqlc.narg(filter_display_name)::text || '%'
        )
    )
  AND (
        sqlc.narg(filter_state)::vetchium.admin_user_state IS NULL OR
        u.admin_user_state = sqlc.narg(filter_state)::vetchium.admin_user_state
    )
  AND (
        sqlc.narg(filter_is_superadmin)::boolean IS NULL OR
        u.is_superadmin = sqlc.narg(filter_is_superadmin)::boolean
    )
  AND (
        sqlc.narg(filter_permission)::text IS NULL OR
        u.is_superadmin OR
        sqlc.narg(filter_permission)::text = ANY(auth.permissions)
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
WITH target AS (
    SELECT u.admin_user_id, u.admin_user_state, u.is_superadmin
    FROM vetchium.admin_users AS u
    WHERE u.admin_user_id = sqlc.arg(target_admin_user_id)::uuid
    FOR UPDATE
), active_superadmins AS (
    SELECT count(*)::bigint AS count
    FROM vetchium.admin_users
    WHERE is_superadmin
      AND admin_user_state = 'active'
), updated AS (
    UPDATE vetchium.admin_users
    SET admin_user_state = 'disabled',
        updated_at = now()
    WHERE admin_user_id = sqlc.arg(target_admin_user_id)::uuid
      AND admin_user_id <> sqlc.arg(actor_admin_user_id)::uuid
      AND (
          NOT EXISTS (SELECT 1 FROM target WHERE is_superadmin) OR
          sqlc.arg(actor_is_superadmin)::boolean
      )
      AND (
          NOT EXISTS (
              SELECT 1 FROM target
              WHERE is_superadmin AND admin_user_state = 'active'
          ) OR (SELECT count FROM active_superadmins) > 1
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
)
SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'not_found'
    WHEN sqlc.arg(target_admin_user_id)::uuid =
        sqlc.arg(actor_admin_user_id)::uuid THEN 'self'
    WHEN EXISTS (SELECT 1 FROM target WHERE is_superadmin) AND
        NOT sqlc.arg(actor_is_superadmin)::boolean THEN 'superadmin_required'
    WHEN EXISTS (
        SELECT 1 FROM target
        WHERE is_superadmin AND admin_user_state = 'active'
    ) AND (SELECT count FROM active_superadmins) <= 1 THEN 'last_superadmin'
    ELSE 'ok'
END::text AS result;

-- name: EnableAdminUser :one
WITH target AS (
    SELECT u.admin_user_id, u.is_superadmin
    FROM vetchium.admin_users AS u
    WHERE u.admin_user_id = sqlc.arg(target_admin_user_id)
), updated AS (
    UPDATE vetchium.admin_users
    SET admin_user_state = 'active',
        updated_at = now()
    WHERE admin_user_id = sqlc.arg(target_admin_user_id)
      AND (
          NOT EXISTS (SELECT 1 FROM target WHERE is_superadmin) OR
          sqlc.arg(actor_is_superadmin)::boolean
      )
    RETURNING admin_user_id
)
SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'not_found'
    WHEN EXISTS (SELECT 1 FROM target WHERE is_superadmin) AND
        NOT sqlc.arg(actor_is_superadmin)::boolean THEN 'superadmin_required'
    ELSE 'ok'
END::text AS result;
