-- name: CreateAdminTOTPEnrollment :one
WITH eligible_user AS (
    SELECT u.admin_user_id
    FROM vetchium.admin_users AS u
    WHERE u.admin_user_id = sqlc.arg(target_admin_user_id)
      AND u.admin_user_state = 'active'
      AND NOT u.totp_enabled
), inserted AS (
    INSERT INTO vetchium.admin_totp_enrollments (
        admin_user_id,
        token_hash,
        secret_ciphertext,
        expires_at
    )
    SELECT
        admin_user_id,
        sqlc.arg(token_hash),
        sqlc.arg(secret_ciphertext),
        sqlc.arg(expires_at)
    FROM eligible_user
    ON CONFLICT (admin_user_id) WHERE active DO UPDATE
    SET token_hash = EXCLUDED.token_hash,
        secret_ciphertext = EXCLUDED.secret_ciphertext,
        created_at = now(),
        expires_at = EXCLUDED.expires_at,
        consumed_at = NULL
    RETURNING admin_totp_enrollment_id, expires_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.totp-enrollment.started',
        'admin_totp_enrollment',
        admin_totp_enrollment_id::text,
        'admin',
        sqlc.arg(target_admin_user_id)::text,
        'admin-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('expires_at', expires_at)
    FROM inserted
)
SELECT admin_totp_enrollment_id, expires_at
FROM inserted;

-- name: GetAdminTOTPEnrollment :one
SELECT
    e.admin_totp_enrollment_id,
    e.admin_user_id,
    e.secret_ciphertext
FROM vetchium.admin_totp_enrollments AS e
JOIN vetchium.admin_users AS u USING (admin_user_id)
WHERE e.token_hash = sqlc.arg(token_hash)
  AND e.admin_user_id = sqlc.arg(target_admin_user_id)
  AND e.active
  AND e.consumed_at IS NULL
  AND e.expires_at > now()
  AND u.admin_user_state = 'active'
  AND NOT u.totp_enabled
FOR UPDATE OF e;

-- name: ConfirmAdminTOTPEnrollment :one
WITH enrollment AS (
    SELECT e.admin_totp_enrollment_id, e.admin_user_id
    FROM vetchium.admin_totp_enrollments AS e
    WHERE e.admin_totp_enrollment_id = sqlc.arg(target_enrollment_id)
      AND e.admin_user_id = sqlc.arg(target_admin_user_id)
      AND e.active
      AND e.consumed_at IS NULL
      AND e.expires_at > now()
    FOR UPDATE
), updated AS (
    UPDATE vetchium.admin_users
    SET totp_secret_ciphertext = sqlc.arg(secret_ciphertext),
        totp_enabled = true,
        totp_last_timestep = sqlc.arg(totp_timestep),
        updated_at = now()
    WHERE admin_user_id IN (SELECT admin_user_id FROM enrollment)
      AND NOT totp_enabled
    RETURNING admin_user_id
), consumed AS (
    UPDATE vetchium.admin_totp_enrollments
    SET consumed_at = now(),
        active = false
    WHERE admin_totp_enrollment_id IN (
        SELECT admin_totp_enrollment_id FROM enrollment
    )
      AND EXISTS (SELECT 1 FROM updated)
    RETURNING admin_user_id
), deleted_codes AS (
    DELETE FROM vetchium.admin_totp_recovery_codes
    WHERE admin_user_id IN (SELECT admin_user_id FROM updated)
), inserted_codes AS (
    INSERT INTO vetchium.admin_totp_recovery_codes (
        admin_user_id,
        code_hash
    )
    SELECT u.admin_user_id, code_hash
    FROM updated AS u
    CROSS JOIN unnest(sqlc.arg(recovery_code_hashes)::bytea[]) AS code_hash
    RETURNING admin_user_id
), sessions AS (
    DELETE FROM vetchium.admin_sessions
    WHERE admin_user_id IN (SELECT admin_user_id FROM updated)
      AND admin_session_id <> sqlc.arg(current_admin_session_id)
), challenges AS (
    UPDATE vetchium.admin_login_challenges
    SET active = false
    WHERE admin_user_id IN (SELECT admin_user_id FROM updated)
      AND active
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.totp.enabled',
        'admin_user',
        admin_user_id::text,
        'admin',
        admin_user_id::text,
        'admin-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('recovery_codes_created', 10)
    FROM consumed
    WHERE (SELECT count(*) FROM inserted_codes) = 10
    RETURNING audit_event_id
)
SELECT
    EXISTS (SELECT 1 FROM audit) AS confirmed;

-- name: CompleteAdminRecoveryCodeLogin :one
WITH consumed_code AS (
    UPDATE vetchium.admin_totp_recovery_codes AS r
    SET consumed_at = now()
    WHERE r.admin_user_id = sqlc.arg(target_admin_user_id)
      AND r.code_hash = sqlc.arg(recovery_code_hash)
      AND r.consumed_at IS NULL
    RETURNING r.admin_user_id, r.code_hash
), consumed_challenge AS (
    UPDATE vetchium.admin_login_challenges AS c
    SET consumed_at = now(),
        active = false
    FROM consumed_code AS code
    WHERE c.admin_login_challenge_id = sqlc.arg(admin_login_challenge_id)
      AND c.admin_user_id = code.admin_user_id
      AND c.active
      AND c.consumed_at IS NULL
      AND c.expires_at > now()
    RETURNING c.admin_user_id
), updated_user AS (
    UPDATE vetchium.admin_users AS u
    SET last_login_at = now(),
        updated_at = now()
    FROM consumed_challenge AS challenge
    WHERE u.admin_user_id = challenge.admin_user_id
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
        admin_user_id,
        sqlc.arg(session_expires_at),
        now()
    FROM updated_user
    RETURNING admin_session_id, created_at, expires_at, authenticated_at,
        admin_user_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.session.created-with-recovery-code',
        'admin_session',
        admin_session_id::text,
        'admin',
        admin_user_id::text,
        'admin-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('authentication_method', 'recovery-code')
    FROM session
)
SELECT
    session.admin_session_id,
    session.created_at,
    session.expires_at,
    session.authenticated_at,
    count(c.code_hash) FILTER (
        WHERE c.consumed_at IS NULL
          AND c.code_hash <> (SELECT code_hash FROM consumed_code)
    )::bigint AS remaining_codes
FROM session
JOIN vetchium.admin_totp_recovery_codes AS c USING (admin_user_id)
GROUP BY session.admin_session_id, session.created_at, session.expires_at,
    session.authenticated_at;

-- name: DisableAdminTOTP :one
WITH updated AS (
    UPDATE vetchium.admin_users AS u
    SET totp_secret_ciphertext = NULL,
        totp_enabled = false,
        totp_last_timestep = NULL,
        updated_at = now()
    WHERE u.admin_user_id = sqlc.arg(target_admin_user_id)
      AND u.admin_user_state = 'active'
    RETURNING u.admin_user_id
), codes AS (
    DELETE FROM vetchium.admin_totp_recovery_codes
    WHERE admin_user_id IN (SELECT admin_user_id FROM updated)
), enrollments AS (
    UPDATE vetchium.admin_totp_enrollments
    SET active = false
    WHERE admin_user_id IN (SELECT admin_user_id FROM updated)
      AND active
), challenges AS (
    UPDATE vetchium.admin_login_challenges
    SET active = false
    WHERE admin_user_id IN (SELECT admin_user_id FROM updated)
      AND active
), sessions AS (
    DELETE FROM vetchium.admin_sessions
    WHERE admin_user_id IN (SELECT admin_user_id FROM updated)
      AND admin_session_id <> sqlc.arg(current_admin_session_id)
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.totp.disabled',
        'admin_user',
        admin_user_id::text,
        'admin',
        admin_user_id::text,
        'admin-api',
        jsonb_build_object('other_sessions_revoked', true)
    FROM updated
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS disabled;

-- name: AdminTOTPEnabled :one
SELECT totp_enabled
FROM vetchium.admin_users
WHERE admin_user_id = $1
  AND admin_user_state = 'active';

-- name: RegenerateAdminTOTPRecoveryCodes :one
WITH eligible_user AS (
    SELECT u.admin_user_id
    FROM vetchium.admin_users AS u
    WHERE u.admin_user_id = sqlc.arg(target_admin_user_id)
      AND u.admin_user_state = 'active'
      AND u.totp_enabled
    FOR UPDATE
), deleted_codes AS (
    DELETE FROM vetchium.admin_totp_recovery_codes
    WHERE admin_user_id IN (SELECT admin_user_id FROM eligible_user)
), inserted_codes AS (
    INSERT INTO vetchium.admin_totp_recovery_codes (
        admin_user_id,
        code_hash
    )
    SELECT u.admin_user_id, code_hash
    FROM eligible_user AS u
    CROSS JOIN unnest(sqlc.arg(recovery_code_hashes)::bytea[]) AS code_hash
    RETURNING admin_user_id
), sessions AS (
    DELETE FROM vetchium.admin_sessions
    WHERE admin_user_id IN (SELECT admin_user_id FROM eligible_user)
      AND admin_session_id <> sqlc.arg(current_admin_session_id)
), challenges AS (
    UPDATE vetchium.admin_login_challenges
    SET active = false
    WHERE admin_user_id IN (SELECT admin_user_id FROM eligible_user)
      AND active
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.totp.recovery-codes-regenerated',
        'admin_user',
        admin_user_id::text,
        'admin',
        admin_user_id::text,
        'admin-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('recovery_codes_created', 10)
    FROM eligible_user
    WHERE (SELECT count(*) FROM inserted_codes) = 10
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS regenerated;
