-- name: GetAdminUserForLogin :one
SELECT
    u.admin_user_id,
    u.email_address,
    u.password_hash,
    u.admin_user_state,
    u.totp_enabled,
    u.totp_secret_ciphertext,
    u.preferred_language
FROM vetchium.admin_users AS u
WHERE u.email_address = $1;

-- name: GetAdminPasswordForReauthentication :one
SELECT u.password_hash
FROM vetchium.admin_sessions AS s
JOIN vetchium.admin_users AS u USING (admin_user_id)
WHERE s.admin_session_id = sqlc.arg(admin_session_id)
  AND s.admin_user_id = sqlc.arg(admin_user_id)
  AND s.expires_at > now()
  AND u.admin_user_state = 'active';

-- name: ReauthenticateAdminSession :one
WITH updated AS (
    UPDATE vetchium.admin_sessions AS s
    SET authenticated_at = now()
    FROM vetchium.admin_users AS u
    WHERE s.admin_session_id = sqlc.arg(admin_session_id)
      AND s.admin_user_id = sqlc.arg(admin_user_id)
      AND s.expires_at > now()
      AND u.admin_user_id = s.admin_user_id
      AND u.admin_user_state = 'active'
      AND u.password_hash = sqlc.arg(verified_password_hash)
    RETURNING s.admin_session_id, s.admin_user_id, s.authenticated_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.session.reauthenticated',
        'admin_session',
        admin_session_id::text,
        'admin',
        admin_user_id::text,
        'admin-api',
        jsonb_build_object('authentication_refreshed', true)
    FROM updated
)
SELECT authenticated_at FROM updated;

-- name: CreateAdminSession :one
WITH updated_admin_user AS (
    UPDATE vetchium.admin_users AS u
    SET last_login_at = now(),
        updated_at = now()
    WHERE u.admin_user_id = sqlc.arg(admin_user_id)
      AND u.admin_user_state = 'active'
      AND u.password_hash = sqlc.arg(verified_password_hash)
      AND NOT u.totp_enabled
    RETURNING u.admin_user_id
), session AS (
    INSERT INTO vetchium.admin_sessions (
        session_token_hash,
        admin_user_id,
        expires_at,
        authenticated_at
    )
    SELECT
        sqlc.arg(session_token_hash),
        u.admin_user_id,
        sqlc.arg(expires_at),
        now()
    FROM updated_admin_user AS u
    RETURNING admin_session_id, admin_user_id, created_at, expires_at,
        authenticated_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.session.created',
        'admin_session',
        admin_session_id::text,
        'admin',
        admin_user_id::text,
        'admin-api',
        jsonb_build_object('authentication_method', 'password')
    FROM session
)
SELECT admin_session_id, created_at, expires_at, authenticated_at
FROM session;

-- name: CreateAdminLoginChallenge :one
WITH eligible_user AS (
    SELECT u.admin_user_id
    FROM vetchium.admin_users AS u
    WHERE u.admin_user_id = sqlc.arg(admin_user_id)
      AND u.password_hash = sqlc.arg(verified_password_hash)
      AND u.admin_user_state = 'active'
      AND u.totp_enabled
    FOR UPDATE
), challenge AS (
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
    RETURNING admin_login_challenge_id, admin_user_id, expires_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.login-challenge.created',
        'admin_login_challenge',
        admin_login_challenge_id::text,
        'admin',
        admin_user_id::text,
        'admin-api',
        jsonb_build_object('expires_at', expires_at)
    FROM challenge
)
SELECT admin_login_challenge_id, expires_at FROM challenge;

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
    u.preferred_language
FROM vetchium.admin_login_challenges AS c
JOIN vetchium.admin_users AS u USING (admin_user_id)
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
    SET totp_last_timestep = sqlc.arg(last_totp_timestep),
        last_login_at = now(),
        updated_at = now()
    WHERE u.admin_user_id = sqlc.arg(admin_user_id)
      AND u.admin_user_state = 'active'
      AND u.totp_enabled
      AND (
          u.totp_last_timestep IS NULL OR
          u.totp_last_timestep < sqlc.arg(last_totp_timestep)
      )
    RETURNING u.admin_user_id
), consumed AS (
    UPDATE vetchium.admin_login_challenges AS c
    SET consumed_at = now(),
        active = false
    FROM accepted_timestep AS u
    WHERE c.admin_login_challenge_id = sqlc.arg(admin_login_challenge_id)
      AND c.admin_user_id = u.admin_user_id
      AND c.active
      AND c.consumed_at IS NULL
      AND c.expires_at > now()
    RETURNING c.admin_user_id
), session AS (
    INSERT INTO vetchium.admin_sessions (
        session_token_hash,
        admin_user_id,
        expires_at,
        authenticated_at,
        last_totp_timestep
    )
    SELECT
        sqlc.arg(session_token_hash),
        admin_user_id,
        sqlc.arg(expires_at),
        now(),
        sqlc.arg(last_totp_timestep)
    FROM consumed
    RETURNING admin_session_id, admin_user_id, created_at, expires_at,
        authenticated_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.session.created-with-totp',
        'admin_session',
        admin_session_id::text,
        'admin',
        admin_user_id::text,
        'admin-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('authentication_method', 'totp')
    FROM session
)
SELECT admin_session_id, created_at, expires_at, authenticated_at
FROM session;

-- name: AuthenticateAdminSession :one
SELECT
    u.admin_user_id,
    s.admin_session_id,
    s.authenticated_at,
    ARRAY(
        SELECT e.permission
        FROM vetchium.admin_effective_permissions AS e
        WHERE e.admin_user_id = u.admin_user_id
        ORDER BY e.permission
    )::text[] AS permissions
FROM vetchium.admin_sessions AS s
JOIN vetchium.admin_users AS u USING (admin_user_id)
WHERE s.session_token_hash = $1
  AND s.expires_at > now()
  AND u.admin_user_state = 'active';

-- name: GetAdminMyInfo :one
SELECT
    u.admin_user_id,
    u.email_address,
    u.display_name,
    u.admin_user_state,
    array_to_json(auth.permissions)::text AS permissions_json,
    u.totp_enabled,
    recovery.remaining_codes AS recovery_codes_remaining,
    u.preferred_language,
    u.created_at,
    s.expires_at
FROM vetchium.admin_sessions AS s
JOIN vetchium.admin_users AS u USING (admin_user_id)
CROSS JOIN LATERAL (
    SELECT ARRAY(
        SELECT e.permission
        FROM vetchium.admin_effective_permissions AS e
        WHERE e.admin_user_id = u.admin_user_id
        ORDER BY e.permission
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

-- name: DeleteAdminSession :one
WITH deleted AS (
    DELETE FROM vetchium.admin_sessions
    WHERE admin_session_id = sqlc.arg(admin_session_id)
      AND admin_user_id = sqlc.arg(admin_user_id)
    RETURNING admin_session_id, admin_user_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.session.revoked',
        'admin_session',
        admin_session_id::text,
        'admin',
        admin_user_id::text,
        'admin-api',
        jsonb_build_object('reason', 'explicit-revocation')
    FROM deleted
)
SELECT count(*)::bigint FROM deleted;

-- name: DeleteAdminSessionByTokenHash :one
WITH deleted AS (
    DELETE FROM vetchium.admin_sessions
    WHERE session_token_hash = sqlc.arg(session_token_hash)
    RETURNING admin_session_id, admin_user_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.session.revoked',
        'admin_session',
        admin_session_id::text,
        'admin',
        admin_user_id::text,
        'admin-api',
        jsonb_build_object('reason', 'logout')
    FROM deleted
)
SELECT count(*)::bigint FROM deleted;
