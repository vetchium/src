-- name: SetAdminPreferredLanguage :execrows
UPDATE vetchium.admin_users AS u
SET preferred_language = $2,
    updated_at = now()
WHERE admin_user_id = $1
  AND admin_user_state = 'active';

-- name: SetAdminDisplayName :execrows
UPDATE vetchium.admin_users AS u
SET display_name = sqlc.arg(display_name),
    updated_at = now()
WHERE u.admin_user_id = sqlc.arg(target_admin_user_id)
  AND u.admin_user_state = 'active';
