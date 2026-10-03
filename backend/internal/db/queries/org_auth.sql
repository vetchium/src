-- A suspended Org's users can still sign in, to restore the domain. When a
-- released domain was claimed by another local Org, the current owner wins.
-- name: GetOrgUserForLogin :one
SELECT
    u.org_user_id,
    u.org_did,
    u.org_user_state,
    u.disabled_reason,
    u.preferred_language,
    p.password_hash,
    (t.org_user_id IS NOT NULL)::boolean AS totp_enabled
FROM vetchium.org_domains AS d
JOIN vetchium.orgs AS o ON o.org_did = d.org_did
JOIN vetchium.org_users AS u
    ON u.org_did = o.org_did
   AND u.email_address = sqlc.arg(email_address)
JOIN vetchium.org_user_passwords AS p ON p.org_user_id = u.org_user_id
LEFT JOIN vetchium.org_user_totp_credentials AS t
    ON t.org_user_id = u.org_user_id
WHERE d.domain = sqlc.arg(domain)
  AND o.org_state IN ('active', 'suspended')
  AND u.org_user_state IN ('active', 'disabled')
ORDER BY (d.domain_state = 'released'), d.created_at DESC
LIMIT 1;

-- name: CreateOrgSession :one
WITH updated_user AS (
    UPDATE vetchium.org_users AS u
    SET last_login_at = now(),
        updated_at = now()
    FROM vetchium.org_user_passwords AS p
    WHERE u.org_user_id = sqlc.arg(org_user_id)
      AND p.org_user_id = u.org_user_id
      AND u.org_user_state = 'active'
      AND p.password_hash = sqlc.arg(verified_password_hash)
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_user_totp_credentials AS t
          WHERE t.org_user_id = u.org_user_id
      )
    RETURNING u.org_user_id
), session AS (
    INSERT INTO vetchium.org_sessions (
        session_token_hash,
        org_user_id,
        expires_at,
        authenticated_at
    )
    SELECT
        sqlc.arg(session_token_hash),
        org_user_id,
        sqlc.arg(expires_at),
        now()
    FROM updated_user
    RETURNING org_session_id, org_user_id, created_at, expires_at,
        authenticated_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.session.created',
        'org_session',
        org_session_id::text,
        'org_user',
        org_user_id::text,
        'orgs-api',
        '{}'::jsonb
    FROM session
)
SELECT org_session_id, created_at, expires_at, authenticated_at
FROM session;

-- name: CreateOrgLoginChallenge :one
WITH eligible_user AS (
    SELECT u.org_user_id
    FROM vetchium.org_users AS u
    JOIN vetchium.org_user_passwords AS p USING (org_user_id)
    JOIN vetchium.org_user_totp_credentials AS t USING (org_user_id)
    WHERE u.org_user_id = sqlc.arg(org_user_id)
      AND p.password_hash = sqlc.arg(verified_password_hash)
      AND u.org_user_state = 'active'
    FOR UPDATE OF u
), challenge AS (
    INSERT INTO vetchium.org_login_challenges (
        org_user_id,
        token_hash,
        expires_at
    )
    SELECT
        org_user_id,
        sqlc.arg(token_hash),
        sqlc.arg(expires_at)
    FROM eligible_user
    ON CONFLICT (org_user_id) WHERE active DO UPDATE
    SET token_hash = EXCLUDED.token_hash,
        created_at = now(),
        expires_at = EXCLUDED.expires_at,
        consumed_at = NULL
    RETURNING org_login_challenge_id, org_user_id, expires_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.login-challenge.created',
        'org_login_challenge',
        org_login_challenge_id::text,
        'org_user',
        org_user_id::text,
        'orgs-api',
        '{}'::jsonb
    FROM challenge
)
SELECT org_login_challenge_id, expires_at FROM challenge;

-- name: ResolveOrgLoginChallengeUser :one
SELECT org_user_id
FROM vetchium.org_login_challenges
WHERE token_hash = $1
  AND active
  AND consumed_at IS NULL
  AND expires_at > now();

-- name: GetOrgLoginChallenge :one
SELECT
    c.org_login_challenge_id,
    c.org_user_id,
    t.secret_ciphertext,
    u.preferred_language
FROM vetchium.org_login_challenges AS c
JOIN vetchium.org_users AS u USING (org_user_id)
JOIN vetchium.org_user_totp_credentials AS t USING (org_user_id)
WHERE c.token_hash = $1
  AND c.active
  AND c.consumed_at IS NULL
  AND c.expires_at > now()
  AND u.org_user_state = 'active'
FOR UPDATE OF c;

-- name: CompleteOrgTOTPLogin :one
WITH accepted_timestep AS (
    UPDATE vetchium.org_user_totp_credentials AS t
    SET last_timestep = sqlc.arg(last_totp_timestep)
    FROM vetchium.org_users AS u
    WHERE t.org_user_id = sqlc.arg(org_user_id)
      AND u.org_user_id = t.org_user_id
      AND u.org_user_state = 'active'
      AND (
          t.last_timestep IS NULL OR
          t.last_timestep < sqlc.arg(last_totp_timestep)
      )
    RETURNING t.org_user_id
), consumed AS (
    UPDATE vetchium.org_login_challenges AS c
    SET consumed_at = now(),
        active = false
    FROM accepted_timestep AS t
    WHERE c.org_login_challenge_id = sqlc.arg(org_login_challenge_id)
      AND c.org_user_id = t.org_user_id
      AND c.active
      AND c.consumed_at IS NULL
      AND c.expires_at > now()
    RETURNING c.org_user_id
), updated_user AS (
    UPDATE vetchium.org_users AS u
    SET last_login_at = now(),
        updated_at = now()
    FROM consumed
    WHERE u.org_user_id = consumed.org_user_id
    RETURNING u.org_user_id
), session AS (
    INSERT INTO vetchium.org_sessions (
        session_token_hash,
        org_user_id,
        expires_at,
        authenticated_at
    )
    SELECT
        sqlc.arg(session_token_hash),
        org_user_id,
        sqlc.arg(expires_at),
        now()
    FROM updated_user
    RETURNING org_session_id, org_user_id, created_at, expires_at,
        authenticated_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.session.created-with-totp',
        'org_session',
        org_session_id::text,
        'org_user',
        org_user_id::text,
        'orgs-api',
        sqlc.arg(idempotency_key),
        '{}'::jsonb
    FROM session
)
SELECT org_session_id, created_at, expires_at, authenticated_at
FROM session;

-- name: CompleteOrgRecoveryCodeLogin :one
WITH eligible_challenge AS (
    SELECT c.org_login_challenge_id, c.org_user_id
    FROM vetchium.org_login_challenges AS c
    WHERE c.org_login_challenge_id = sqlc.arg(org_login_challenge_id)
      AND c.org_user_id = sqlc.arg(org_user_id)
      AND c.active
      AND c.consumed_at IS NULL
      AND c.expires_at > now()
    FOR UPDATE
), consumed_code AS (
    UPDATE vetchium.org_totp_recovery_codes AS r
    SET consumed_at = now()
    WHERE r.org_user_id IN (SELECT org_user_id FROM eligible_challenge)
      AND r.code_hash = sqlc.arg(recovery_code_hash)
      AND r.consumed_at IS NULL
    RETURNING r.org_user_id, r.code_hash
), consumed_challenge AS (
    UPDATE vetchium.org_login_challenges AS c
    SET consumed_at = now(),
        active = false
    FROM consumed_code AS code
    WHERE c.org_login_challenge_id = sqlc.arg(org_login_challenge_id)
      AND c.org_user_id = code.org_user_id
      AND c.active
      AND c.consumed_at IS NULL
      AND c.expires_at > now()
    RETURNING c.org_user_id
), updated_user AS (
    UPDATE vetchium.org_users AS u
    SET last_login_at = now(),
        updated_at = now()
    FROM consumed_challenge AS challenge
    WHERE u.org_user_id = challenge.org_user_id
      AND u.org_user_state = 'active'
    RETURNING u.org_user_id
), session AS (
    INSERT INTO vetchium.org_sessions (
        session_token_hash,
        org_user_id,
        expires_at,
        authenticated_at
    )
    SELECT
        sqlc.arg(session_token_hash),
        org_user_id,
        sqlc.arg(expires_at),
        now()
    FROM updated_user
    RETURNING org_session_id, org_user_id, created_at, expires_at,
        authenticated_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.session.created-with-recovery-code',
        'org_session',
        org_session_id::text,
        'org_user',
        org_user_id::text,
        'orgs-api',
        sqlc.arg(idempotency_key),
        '{}'::jsonb
    FROM session
)
SELECT
    session.org_session_id,
    session.created_at,
    session.expires_at,
    session.authenticated_at,
    count(c.code_hash) FILTER (
        WHERE c.consumed_at IS NULL
          AND c.code_hash <> (SELECT code_hash FROM consumed_code)
    )::bigint AS remaining_codes
FROM session
JOIN vetchium.org_totp_recovery_codes AS c USING (org_user_id)
GROUP BY session.org_session_id, session.created_at, session.expires_at,
    session.authenticated_at;

-- name: AuthenticateOrgSession :one
SELECT
    u.org_user_id,
    u.org_did,
    s.org_session_id,
    s.authenticated_at,
    o.org_state,
    ARRAY(
        SELECT e.permission
        FROM vetchium.org_effective_permissions AS e
        WHERE e.org_user_id = u.org_user_id
        ORDER BY e.permission
    )::text[] AS permissions
FROM vetchium.org_sessions AS s
JOIN vetchium.org_users AS u USING (org_user_id)
JOIN vetchium.orgs AS o ON o.org_did = u.org_did
WHERE s.session_token_hash = $1
  AND s.expires_at > now()
  AND u.org_user_state = 'active'
  AND o.org_state IN ('active', 'suspended');

-- name: DeleteOrgSessionByTokenHash :exec
WITH deleted AS (
    DELETE FROM vetchium.org_sessions
    WHERE session_token_hash = sqlc.arg(session_token_hash)
    RETURNING org_session_id, org_user_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.session.revoked',
        'org_session',
        org_session_id::text,
        'org_user',
        org_user_id::text,
        'orgs-api',
        jsonb_build_object('reason', 'logout')
    FROM deleted
    RETURNING audit_event_id
)
SELECT 1 FROM audit;

-- name: GetOrgPasswordForReauthentication :one
SELECT p.password_hash
FROM vetchium.org_sessions AS s
JOIN vetchium.org_users AS u USING (org_user_id)
JOIN vetchium.org_user_passwords AS p USING (org_user_id)
WHERE s.org_session_id = sqlc.arg(org_session_id)
  AND s.org_user_id = sqlc.arg(org_user_id)
  AND s.expires_at > now()
  AND u.org_user_state = 'active';

-- name: ReauthenticateOrgSession :one
WITH updated AS (
    UPDATE vetchium.org_sessions AS s
    SET authenticated_at = now()
    FROM vetchium.org_users AS u, vetchium.org_user_passwords AS p
    WHERE s.org_session_id = sqlc.arg(org_session_id)
      AND s.org_user_id = sqlc.arg(org_user_id)
      AND s.expires_at > now()
      AND u.org_user_id = s.org_user_id
      AND p.org_user_id = s.org_user_id
      AND u.org_user_state = 'active'
      AND p.password_hash = sqlc.arg(verified_password_hash)
    RETURNING s.org_session_id, s.org_user_id, s.authenticated_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.session.reauthenticated',
        'org_session',
        org_session_id::text,
        'org_user',
        org_user_id::text,
        'orgs-api',
        jsonb_build_object('authentication_refreshed', true)
    FROM updated
)
SELECT authenticated_at FROM updated;

-- name: LockOrgUserCredentialMutation :one
SELECT org_user_id
FROM vetchium.org_users
WHERE org_user_id = $1
FOR UPDATE;
