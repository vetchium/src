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
WITH target AS MATERIALIZED (
    SELECT u.admin_user_id
    FROM vetchium.admin_users AS u
    WHERE u.admin_user_id = sqlc.arg(target_admin_user_id)
      AND u.admin_user_state = 'active'
    FOR UPDATE
), input AS (
    SELECT
        unnest(sqlc.arg(language_codes)::text[]) AS language_code,
        unnest(sqlc.arg(display_names)::text[]) AS display_name
), deleted AS (
    DELETE FROM vetchium.admin_display_names AS d
    USING target AS t
    WHERE d.admin_user_id = t.admin_user_id
    RETURNING d.admin_user_id
), inserted AS (
    INSERT INTO vetchium.admin_display_names (
        admin_user_id,
        language_code,
        display_name
    )
    SELECT t.admin_user_id, i.language_code, i.display_name
    FROM target AS t
    CROSS JOIN input AS i
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
FROM target AS t
CROSS JOIN (SELECT count(*) FROM inserted) AS insertion_barrier
WHERE u.admin_user_id = t.admin_user_id;
