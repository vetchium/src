-- name: CreateHubTOTPEnrollment :one
WITH eligible_user AS (
    SELECT u.hub_user_did
    FROM vetchium.hub_users AS u
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
      AND NOT u.totp_enabled
), enrollment AS (
    INSERT INTO vetchium.hub_totp_enrollments (
        hub_user_did,
        token_hash,
        secret_ciphertext,
        expires_at
    )
    SELECT
        hub_user_did,
        sqlc.arg(token_hash),
        sqlc.arg(secret_ciphertext),
        sqlc.arg(expires_at)
    FROM eligible_user
    ON CONFLICT (hub_user_did) WHERE active DO UPDATE
    SET token_hash = EXCLUDED.token_hash,
        secret_ciphertext = EXCLUDED.secret_ciphertext,
        created_at = now(),
        expires_at = EXCLUDED.expires_at,
        consumed_at = NULL
    RETURNING hub_totp_enrollment_id, hub_user_did, expires_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.totp-enrollment.started',
        'hub_totp_enrollment',
        hub_totp_enrollment_id::text,
        'hub_user',
        hub_user_did::text,
        'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('expires_at', expires_at)
    FROM enrollment
)
SELECT hub_totp_enrollment_id, expires_at FROM enrollment;

-- name: GetHubTOTPEnrollment :one
SELECT
    e.hub_totp_enrollment_id,
    e.hub_user_did,
    e.secret_ciphertext
FROM vetchium.hub_totp_enrollments AS e
JOIN vetchium.hub_users AS u USING (hub_user_did)
WHERE e.token_hash = sqlc.arg(token_hash)
  AND e.hub_user_did = sqlc.arg(hub_user_did)
  AND e.active
  AND e.consumed_at IS NULL
  AND e.expires_at > now()
  AND u.hub_user_state = 'active'
  AND NOT u.totp_enabled
FOR UPDATE OF e;

-- name: ConfirmHubTOTPEnrollment :one
WITH enrollment AS (
    SELECT e.hub_totp_enrollment_id, e.hub_user_did
    FROM vetchium.hub_totp_enrollments AS e
    WHERE e.hub_totp_enrollment_id = sqlc.arg(hub_totp_enrollment_id)
      AND e.hub_user_did = sqlc.arg(hub_user_did)
      AND e.active
      AND e.consumed_at IS NULL
      AND e.expires_at > now()
    FOR UPDATE
), updated AS (
    UPDATE vetchium.hub_users
    SET totp_secret_ciphertext = sqlc.arg(secret_ciphertext),
        totp_enabled = true,
        totp_last_timestep = sqlc.arg(totp_timestep),
        updated_at = now()
    WHERE hub_user_did IN (SELECT hub_user_did FROM enrollment)
      AND NOT totp_enabled
    RETURNING hub_user_did
), consumed AS (
    UPDATE vetchium.hub_totp_enrollments
    SET consumed_at = now(),
        active = false
    WHERE hub_totp_enrollment_id IN (
        SELECT hub_totp_enrollment_id FROM enrollment
    )
      AND EXISTS (SELECT 1 FROM updated)
    RETURNING hub_user_did
), deleted_codes AS (
    DELETE FROM vetchium.hub_totp_recovery_codes
    WHERE hub_user_did IN (SELECT hub_user_did FROM updated)
), inserted_codes AS (
    INSERT INTO vetchium.hub_totp_recovery_codes (
        hub_user_did,
        code_hash
    )
    SELECT u.hub_user_did, code_hash
    FROM updated AS u
    CROSS JOIN unnest(sqlc.arg(recovery_code_hashes)::bytea[]) AS code_hash
    RETURNING hub_user_did
), sessions AS (
    DELETE FROM vetchium.hub_sessions
    WHERE hub_user_did IN (SELECT hub_user_did FROM updated)
      AND hub_session_id <> sqlc.arg(current_hub_session_id)
), challenges AS (
    UPDATE vetchium.hub_login_challenges
    SET active = false
    WHERE hub_user_did IN (SELECT hub_user_did FROM updated)
      AND active
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.totp.enabled',
        'hub_user',
        hub_user_did::text,
        'hub_user',
        hub_user_did::text,
        'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('recovery_codes_created', 10)
    FROM consumed
    WHERE (SELECT count(*) FROM inserted_codes) = 10
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS confirmed;

-- name: CompleteHubRecoveryCodeLogin :one
WITH eligible_challenge AS (
    SELECT c.hub_login_challenge_id, c.hub_user_did
    FROM vetchium.hub_login_challenges AS c
    WHERE c.hub_login_challenge_id = sqlc.arg(hub_login_challenge_id)
      AND c.hub_user_did = sqlc.arg(hub_user_did)
      AND c.active
      AND c.consumed_at IS NULL
      AND c.expires_at > now()
    FOR UPDATE
), consumed_code AS (
    UPDATE vetchium.hub_totp_recovery_codes AS r
    SET consumed_at = now()
    WHERE r.hub_user_did IN (
          SELECT hub_user_did FROM eligible_challenge
      )
      AND r.code_hash = sqlc.arg(recovery_code_hash)
      AND r.consumed_at IS NULL
    RETURNING r.hub_user_did, r.code_hash
), consumed_challenge AS (
    UPDATE vetchium.hub_login_challenges AS c
    SET consumed_at = now(),
        active = false
    FROM consumed_code AS code
    WHERE c.hub_login_challenge_id = sqlc.arg(hub_login_challenge_id)
      AND c.hub_user_did = code.hub_user_did
      AND c.active
      AND c.consumed_at IS NULL
      AND c.expires_at > now()
    RETURNING c.hub_user_did
), updated_user AS (
    UPDATE vetchium.hub_users AS u
    SET last_login_at = now(),
        updated_at = now()
    FROM consumed_challenge AS challenge
    WHERE u.hub_user_did = challenge.hub_user_did
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
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.session.created-with-recovery-code',
        'hub_session',
        hub_session_id::text,
        'hub_user',
        hub_user_did::text,
        'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('remembered', sqlc.arg(remembered)::boolean)
    FROM session
)
SELECT
    session.hub_session_id,
    session.created_at,
    session.expires_at,
    session.authenticated_at,
    count(c.code_hash) FILTER (
        WHERE c.consumed_at IS NULL
          AND c.code_hash <> (SELECT code_hash FROM consumed_code)
    )::bigint AS remaining_codes
FROM session
JOIN vetchium.hub_totp_recovery_codes AS c USING (hub_user_did)
GROUP BY session.hub_session_id, session.created_at, session.expires_at,
    session.authenticated_at;

-- name: DisableHubTOTP :one
WITH updated AS (
    UPDATE vetchium.hub_users AS u
    SET totp_secret_ciphertext = NULL,
        totp_enabled = false,
        totp_last_timestep = NULL,
        updated_at = now()
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
    RETURNING u.hub_user_did
), codes AS (
    DELETE FROM vetchium.hub_totp_recovery_codes
    WHERE hub_user_did IN (SELECT hub_user_did FROM updated)
), enrollments AS (
    UPDATE vetchium.hub_totp_enrollments
    SET active = false
    WHERE hub_user_did IN (SELECT hub_user_did FROM updated)
      AND active
), challenges AS (
    UPDATE vetchium.hub_login_challenges
    SET active = false
    WHERE hub_user_did IN (SELECT hub_user_did FROM updated)
      AND active
), sessions AS (
    DELETE FROM vetchium.hub_sessions
    WHERE hub_user_did IN (SELECT hub_user_did FROM updated)
      AND hub_session_id <> sqlc.arg(current_hub_session_id)
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.totp.disabled',
        'hub_user',
        hub_user_did::text,
        'hub_user',
        hub_user_did::text,
        'hub-api',
        jsonb_build_object('other_sessions_revoked', true)
    FROM updated
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS disabled;

-- name: HubTOTPEnabled :one
SELECT totp_enabled
FROM vetchium.hub_users
WHERE hub_user_did = $1
  AND hub_user_state = 'active';

-- name: RegenerateHubTOTPRecoveryCodes :one
WITH eligible_user AS (
    SELECT u.hub_user_did
    FROM vetchium.hub_users AS u
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
      AND u.totp_enabled
    FOR UPDATE
), deleted_codes AS (
    DELETE FROM vetchium.hub_totp_recovery_codes
    WHERE hub_user_did IN (SELECT hub_user_did FROM eligible_user)
), inserted_codes AS (
    INSERT INTO vetchium.hub_totp_recovery_codes (
        hub_user_did,
        code_hash
    )
    SELECT u.hub_user_did, code_hash
    FROM eligible_user AS u
    CROSS JOIN unnest(sqlc.arg(recovery_code_hashes)::bytea[]) AS code_hash
    RETURNING hub_user_did
), sessions AS (
    DELETE FROM vetchium.hub_sessions
    WHERE hub_user_did IN (SELECT hub_user_did FROM eligible_user)
      AND hub_session_id <> sqlc.arg(current_hub_session_id)
), challenges AS (
    UPDATE vetchium.hub_login_challenges
    SET active = false
    WHERE hub_user_did IN (SELECT hub_user_did FROM eligible_user)
      AND active
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.totp.recovery-codes-regenerated',
        'hub_user',
        hub_user_did::text,
        'hub_user',
        hub_user_did::text,
        'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('recovery_codes_created', 10)
    FROM eligible_user
    WHERE (SELECT count(*) FROM inserted_codes) = 10
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS regenerated;
