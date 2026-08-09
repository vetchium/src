-- name: GetAdminCompanyRegionalDefaults :one
SELECT default_language, default_timezone
FROM vetchium.admin_company_settings
WHERE singleton;

-- name: SetAdminCompanyRegionalDefaults :exec
UPDATE vetchium.admin_company_settings
SET default_language = $1,
    default_timezone = $2,
    updated_at = now()
WHERE singleton;

-- name: SetAdminPreferredLanguage :execrows
UPDATE vetchium.admin_users AS u
SET preferred_language = $2,
    updated_at = now()
WHERE admin_user_id = $1
  AND admin_user_state = 'active';

-- name: SetAdminPreferredTimezone :execrows
UPDATE vetchium.admin_users
SET preferred_timezone = $2,
    updated_at = now()
WHERE admin_user_id = $1
  AND admin_user_state = 'active';

-- name: SetAdminDisplayNames :execrows
WITH input AS (
    SELECT
        unnest(sqlc.arg(language_codes)::text[]) AS language_code,
        unnest(sqlc.arg(display_names)::text[]) AS display_name
), deleted AS (
    DELETE FROM vetchium.admin_display_names
    WHERE admin_user_id = sqlc.arg(target_admin_user_id)
    RETURNING admin_user_id
), inserted AS (
    INSERT INTO vetchium.admin_display_names (
        admin_user_id,
        language_code,
        display_name
    )
    SELECT sqlc.arg(target_admin_user_id), language_code, display_name
    FROM input
    CROSS JOIN (SELECT count(*) FROM deleted) AS deletion_barrier
    RETURNING admin_user_id
)
UPDATE vetchium.admin_users AS u
SET primary_display_name_language = sqlc.arg(primary_language),
    display_name = (
        SELECT display_name
        FROM input
        WHERE language_code = sqlc.arg(primary_language)
    ),
    updated_at = now()
WHERE u.admin_user_id = sqlc.arg(target_admin_user_id)
  AND u.admin_user_state = 'active';
