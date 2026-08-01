-- name: GetAdminUserForLogin :one
SELECT
    admin_user_id,
    email_address,
    display_name,
    password_hash,
    admin_user_state
FROM vetchium.admin_users
WHERE email_address = $1;

-- name: CreateAdminSession :one
WITH updated_admin_user AS (
    UPDATE vetchium.admin_users AS u
    SET last_login_at = now(),
        updated_at = now()
    WHERE u.admin_user_id = $2
      AND u.admin_user_state = 'active'
    RETURNING u.admin_user_id
)
INSERT INTO vetchium.admin_sessions (
    session_token_hash,
    admin_user_id,
    expires_at
)
SELECT $1, u.admin_user_id, $3
FROM updated_admin_user AS u
RETURNING admin_session_id, created_at, expires_at;

-- name: GetAuthenticatedAdmin :one
SELECT
    u.admin_user_id,
    u.email_address,
    u.display_name,
    u.admin_user_state,
    u.last_login_at,
    u.created_at,
    s.admin_session_id,
    s.session_token_hash,
    s.expires_at
FROM vetchium.admin_sessions AS s
JOIN vetchium.admin_users AS u USING (admin_user_id)
WHERE s.session_token_hash = $1
  AND s.expires_at > now()
  AND u.admin_user_state = 'active';

-- name: DeleteAdminSession :execrows
DELETE FROM vetchium.admin_sessions
WHERE session_token_hash = $1;

-- name: DeleteExpiredAdminSessions :execrows
DELETE FROM vetchium.admin_sessions
WHERE expires_at <= now();
