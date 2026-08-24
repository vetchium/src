-- name: GetHubUserForLogin :one
SELECT
    hub_user_did,
    handle,
    email_address,
    password_hash,
    hub_user_state,
    totp_enabled,
    totp_secret_ciphertext,
    preferred_language,
    resident_country
FROM vetchium.hub_users
WHERE email_address = $1;

-- name: GetHubPasswordForReauthentication :one
SELECT u.password_hash
FROM vetchium.hub_sessions AS s
JOIN vetchium.hub_users AS u USING (hub_user_did)
WHERE s.hub_session_id = sqlc.arg(hub_session_id)
  AND s.hub_user_did = sqlc.arg(hub_user_did)
  AND s.expires_at > now()
  AND u.hub_user_state = 'active';

-- name: ReauthenticateHubSession :one
WITH updated AS (
    UPDATE vetchium.hub_sessions AS s
    SET authenticated_at = now()
    FROM vetchium.hub_users AS u
    WHERE s.hub_session_id = sqlc.arg(hub_session_id)
      AND s.hub_user_did = sqlc.arg(hub_user_did)
      AND s.expires_at > now()
      AND u.hub_user_did = s.hub_user_did
      AND u.hub_user_state = 'active'
      AND u.password_hash = sqlc.arg(verified_password_hash)
    RETURNING s.hub_session_id, s.hub_user_did, s.authenticated_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.session.reauthenticated',
        'hub_session',
        hub_session_id::text,
        'hub_user',
        hub_user_did::text,
        'hub-api',
        jsonb_build_object('authentication_refreshed', true)
    FROM updated
)
SELECT authenticated_at FROM updated;

-- name: CreateHubSession :one
WITH updated_user AS (
    UPDATE vetchium.hub_users AS u
    SET last_login_at = now(),
        updated_at = now()
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
      AND u.password_hash = sqlc.arg(verified_password_hash)
      AND NOT u.totp_enabled
    RETURNING u.hub_user_did
), session AS (
    INSERT INTO vetchium.hub_sessions (
        session_token_hash,
        hub_user_did,
        expires_at,
        authenticated_at,
        remembered
    )
    SELECT
        sqlc.arg(session_token_hash),
        hub_user_did,
        sqlc.arg(expires_at),
        now(),
        sqlc.arg(remembered)
    FROM updated_user
    RETURNING hub_session_id, hub_user_did, created_at, expires_at,
        authenticated_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.session.created',
        'hub_session',
        hub_session_id::text,
        'hub_user',
        hub_user_did::text,
        'hub-api',
        jsonb_build_object('remembered', sqlc.arg(remembered)::boolean)
    FROM session
)
SELECT hub_session_id, created_at, expires_at, authenticated_at
FROM session;

-- name: CreateHubLoginChallenge :one
WITH eligible_user AS (
    SELECT u.hub_user_did
    FROM vetchium.hub_users AS u
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.password_hash = sqlc.arg(verified_password_hash)
      AND u.hub_user_state = 'active'
      AND u.totp_enabled
    FOR UPDATE
), challenge AS (
    INSERT INTO vetchium.hub_login_challenges (
        hub_user_did,
        token_hash,
        remembered,
        expires_at
    )
    SELECT
        hub_user_did,
        sqlc.arg(token_hash),
        sqlc.arg(remembered),
        sqlc.arg(expires_at)
    FROM eligible_user
    ON CONFLICT (hub_user_did) WHERE active DO UPDATE
    SET token_hash = EXCLUDED.token_hash,
        remembered = EXCLUDED.remembered,
        created_at = now(),
        expires_at = EXCLUDED.expires_at,
        consumed_at = NULL
    RETURNING hub_login_challenge_id, hub_user_did, expires_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.login-challenge.created',
        'hub_login_challenge',
        hub_login_challenge_id::text,
        'hub_user',
        hub_user_did::text,
        'hub-api',
        jsonb_build_object('remembered', sqlc.arg(remembered)::boolean)
    FROM challenge
)
SELECT hub_login_challenge_id, expires_at FROM challenge;

-- name: ResolveHubLoginChallengeUser :one
SELECT hub_user_did
FROM vetchium.hub_login_challenges
WHERE token_hash = $1
  AND active
  AND consumed_at IS NULL
  AND expires_at > now();

-- name: GetHubLoginChallenge :one
SELECT
    c.hub_login_challenge_id,
    c.hub_user_did,
    c.remembered,
    u.totp_secret_ciphertext,
    u.preferred_language,
    u.resident_country,
    u.handle
FROM vetchium.hub_login_challenges AS c
JOIN vetchium.hub_users AS u USING (hub_user_did)
WHERE c.token_hash = $1
  AND c.active
  AND c.consumed_at IS NULL
  AND c.expires_at > now()
  AND u.hub_user_state = 'active'
  AND u.totp_enabled
FOR UPDATE OF c;

-- name: CompleteHubTOTPLogin :one
WITH accepted_timestep AS (
    UPDATE vetchium.hub_users AS u
    SET totp_last_timestep = sqlc.arg(last_totp_timestep),
        last_login_at = now(),
        updated_at = now()
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
      AND u.totp_enabled
      AND (
          u.totp_last_timestep IS NULL OR
          u.totp_last_timestep < sqlc.arg(last_totp_timestep)
      )
    RETURNING u.hub_user_did
), consumed AS (
    UPDATE vetchium.hub_login_challenges AS c
    SET consumed_at = now(),
        active = false
    FROM accepted_timestep AS u
    WHERE c.hub_login_challenge_id = sqlc.arg(hub_login_challenge_id)
      AND c.hub_user_did = u.hub_user_did
      AND c.active
      AND c.consumed_at IS NULL
      AND c.expires_at > now()
    RETURNING c.hub_user_did
), session AS (
    INSERT INTO vetchium.hub_sessions (
        session_token_hash,
        hub_user_did,
        expires_at,
        authenticated_at,
        remembered
    )
    SELECT
        sqlc.arg(session_token_hash),
        hub_user_did,
        sqlc.arg(expires_at),
        now(),
        sqlc.arg(remembered)
    FROM consumed
    RETURNING hub_session_id, hub_user_did, created_at, expires_at,
        authenticated_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.session.created-with-totp',
        'hub_session',
        hub_session_id::text,
        'hub_user',
        hub_user_did::text,
        'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('remembered', sqlc.arg(remembered)::boolean)
    FROM session
)
SELECT hub_session_id, created_at, expires_at, authenticated_at
FROM session;

-- name: AuthenticateHubSession :one
SELECT
    u.hub_user_did,
    s.hub_session_id,
    s.authenticated_at
FROM vetchium.hub_sessions AS s
JOIN vetchium.hub_users AS u USING (hub_user_did)
WHERE s.session_token_hash = $1
  AND s.expires_at > now()
  AND u.hub_user_state = 'active';

-- name: DeleteHubSessionByTokenHash :exec
WITH deleted AS (
    DELETE FROM vetchium.hub_sessions
    WHERE session_token_hash = sqlc.arg(session_token_hash)
    RETURNING hub_session_id, hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.session.revoked',
        'hub_session',
        hub_session_id::text,
        'hub_user',
        hub_user_did::text,
        'hub-api',
        jsonb_build_object('reason', 'logout')
    FROM deleted
    RETURNING audit_event_id
)
SELECT 1 FROM audit;
