-- name: GetAdminUserForLogin :one
SELECT
    u.admin_user_id,
    u.email_address,
    u.password_hash,
    u.admin_user_state,
    u.totp_enabled,
    u.totp_secret_ciphertext,
    COALESCE(u.preferred_language, c.default_language)::text AS effective_language,
    COALESCE(u.preferred_timezone, c.default_timezone)::text AS effective_timezone
FROM vetchium.admin_users AS u
CROSS JOIN vetchium.admin_company_settings AS c
WHERE u.email_address = $1;

-- name: CreateAdminSession :one
WITH updated_admin_user AS (
    UPDATE vetchium.admin_users AS u
    SET last_login_at = now(),
        updated_at = now()
    WHERE u.admin_user_id = $2
      AND u.admin_user_state = 'active'
      AND u.password_hash = sqlc.arg(verified_password_hash)
      AND NOT u.totp_enabled
    RETURNING u.admin_user_id
)
INSERT INTO vetchium.admin_sessions (
    session_token_hash,
    admin_user_id,
    expires_at,
    authenticated_at
)
SELECT $1, u.admin_user_id, $3, now()
FROM updated_admin_user AS u
RETURNING admin_session_id, created_at, expires_at, authenticated_at;

-- name: CreateAdminLoginChallenge :one
WITH eligible_user AS (
    SELECT u.admin_user_id
    FROM vetchium.admin_users AS u
    WHERE u.admin_user_id = sqlc.arg(admin_user_id)
      AND u.password_hash = sqlc.arg(verified_password_hash)
      AND u.admin_user_state = 'active'
      AND u.totp_enabled
    FOR UPDATE
)
INSERT INTO vetchium.admin_login_challenges (
    admin_user_id,
    token_hash,
    expires_at
)
SELECT admin_user_id, sqlc.arg(token_hash), sqlc.arg(expires_at)
FROM eligible_user
ON CONFLICT (admin_user_id) WHERE active DO UPDATE
SET token_hash = EXCLUDED.token_hash,
    created_at = now(),
    expires_at = EXCLUDED.expires_at,
    consumed_at = NULL
RETURNING admin_login_challenge_id, expires_at;

-- name: ResolveAdminLoginChallengeUser :one
SELECT c.admin_user_id
FROM vetchium.admin_login_challenges AS c
WHERE c.token_hash = $1
  AND c.active
  AND c.consumed_at IS NULL
  AND c.expires_at > now();

-- name: GetAdminLoginChallenge :one
SELECT
    c.admin_login_challenge_id,
    c.admin_user_id,
    u.totp_secret_ciphertext,
    u.admin_user_state,
    COALESCE(u.preferred_language, s.default_language)::text AS effective_language,
    COALESCE(u.preferred_timezone, s.default_timezone)::text AS effective_timezone
FROM vetchium.admin_login_challenges AS c
JOIN vetchium.admin_users AS u USING (admin_user_id)
CROSS JOIN vetchium.admin_company_settings AS s
WHERE c.token_hash = $1
  AND c.active
  AND c.consumed_at IS NULL
  AND c.expires_at > now()
  AND u.admin_user_state = 'active'
  AND u.totp_enabled
FOR UPDATE OF c;

-- name: CompleteAdminTOTPLogin :one
WITH accepted_timestep AS (
    UPDATE vetchium.admin_users AS u
    SET totp_last_timestep = $3,
        last_login_at = now(),
        updated_at = now()
    WHERE u.admin_user_id = $2
      AND u.admin_user_state = 'active'
      AND u.totp_enabled
      AND (u.totp_last_timestep IS NULL OR u.totp_last_timestep < $3)
    RETURNING u.admin_user_id
), consumed AS (
    UPDATE vetchium.admin_login_challenges AS c
    SET consumed_at = now(),
        active = false
    FROM accepted_timestep AS u
    WHERE c.admin_login_challenge_id = $1
      AND c.admin_user_id = u.admin_user_id
      AND c.active
      AND c.consumed_at IS NULL
      AND c.expires_at > now()
    RETURNING c.admin_user_id
)
INSERT INTO vetchium.admin_sessions (
    session_token_hash,
    admin_user_id,
    expires_at,
    authenticated_at,
    last_totp_timestep
)
SELECT $4, admin_user_id, $5, now(), $3
FROM consumed
RETURNING admin_session_id, created_at, expires_at, authenticated_at;

-- name: AuthenticateAdminSession :one
SELECT
    u.admin_user_id,
    s.admin_session_id,
    s.authenticated_at,
    u.is_superadmin,
    CASE
        WHEN u.is_superadmin THEN ARRAY[
            'admin:view_users',
            'admin:manage_users'
        ]::text[]
        ELSE ARRAY(
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
        )::text[]
    END AS permissions
FROM vetchium.admin_sessions AS s
JOIN vetchium.admin_users AS u USING (admin_user_id)
WHERE s.session_token_hash = $1
  AND s.expires_at > now()
  AND u.admin_user_state = 'active';

-- name: GetAdminMyInfo :one
SELECT
    u.admin_user_id,
    u.email_address,
    names.display_names::text AS display_names_json,
    u.primary_display_name_language,
    u.admin_user_state,
    u.is_superadmin,
    array_to_json(CASE WHEN u.is_superadmin THEN ARRAY[
        'admin:view_users',
        'admin:manage_users'
    ]::text[] ELSE auth.permissions END)::text AS permissions_json,
    u.totp_enabled,
    recovery.remaining_codes AS recovery_codes_remaining,
    u.preferred_language,
    u.preferred_timezone,
    COALESCE(u.preferred_language, c.default_language)::text AS effective_language,
    COALESCE(u.preferred_timezone, c.default_timezone)::text AS effective_timezone,
    u.created_at,
    s.expires_at
FROM vetchium.admin_sessions AS s
JOIN vetchium.admin_users AS u USING (admin_user_id)
CROSS JOIN vetchium.admin_company_settings AS c
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
CROSS JOIN LATERAL (
    SELECT count(*)::bigint AS remaining_codes
    FROM vetchium.admin_totp_recovery_codes AS r
    WHERE r.admin_user_id = u.admin_user_id
      AND r.consumed_at IS NULL
) AS recovery
WHERE s.admin_session_id = $1
  AND u.admin_user_id = $2
  AND s.expires_at > now()
  AND u.admin_user_state = 'active';

-- name: DeleteAdminSession :execrows
DELETE FROM vetchium.admin_sessions
WHERE admin_session_id = $1
  AND admin_user_id = $2;

-- name: DeleteAdminSessionByTokenHash :execrows
DELETE FROM vetchium.admin_sessions
WHERE session_token_hash = $1;
