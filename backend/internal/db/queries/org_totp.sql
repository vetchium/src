-- name: CreateOrgTOTPEnrollment :one
WITH eligible_user AS (
    SELECT u.org_user_id
    FROM vetchium.org_users AS u
    WHERE u.org_user_id = sqlc.arg(org_user_id)
      AND u.org_user_state = 'active'
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_user_totp_credentials AS t
          WHERE t.org_user_id = u.org_user_id
      )
), enrollment AS (
    INSERT INTO vetchium.org_totp_enrollments (
        org_user_id,
        token_hash,
        secret_ciphertext,
        expires_at
    )
    SELECT
        org_user_id,
        sqlc.arg(token_hash),
        sqlc.arg(secret_ciphertext),
        sqlc.arg(expires_at)
    FROM eligible_user
    ON CONFLICT (org_user_id) WHERE active DO UPDATE
    SET token_hash = EXCLUDED.token_hash,
        secret_ciphertext = EXCLUDED.secret_ciphertext,
        created_at = now(),
        expires_at = EXCLUDED.expires_at,
        consumed_at = NULL
    RETURNING org_totp_enrollment_id, org_user_id, expires_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.totp-enrollment.started',
        'org_totp_enrollment',
        org_totp_enrollment_id::text,
        'org_user',
        org_user_id::text,
        'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('expires_at', expires_at)
    FROM enrollment
)
SELECT org_totp_enrollment_id, expires_at FROM enrollment;

-- name: GetOrgTOTPEnrollment :one
SELECT
    e.org_totp_enrollment_id,
    e.org_user_id,
    e.secret_ciphertext
FROM vetchium.org_totp_enrollments AS e
JOIN vetchium.org_users AS u USING (org_user_id)
WHERE e.token_hash = sqlc.arg(token_hash)
  AND e.org_user_id = sqlc.arg(org_user_id)
  AND e.active
  AND e.consumed_at IS NULL
  AND e.expires_at > now()
  AND u.org_user_state = 'active'
  AND NOT EXISTS (
      SELECT 1 FROM vetchium.org_user_totp_credentials AS t
      WHERE t.org_user_id = e.org_user_id
  )
FOR UPDATE OF e;

-- name: ConfirmOrgTOTPEnrollment :one
WITH enrollment AS (
    SELECT e.org_totp_enrollment_id, e.org_user_id
    FROM vetchium.org_totp_enrollments AS e
    WHERE e.org_totp_enrollment_id = sqlc.arg(org_totp_enrollment_id)
      AND e.org_user_id = sqlc.arg(org_user_id)
      AND e.active
      AND e.consumed_at IS NULL
      AND e.expires_at > now()
    FOR UPDATE
), enabled AS (
    INSERT INTO vetchium.org_user_totp_credentials (
        org_user_id,
        secret_ciphertext,
        last_timestep
    )
    SELECT
        org_user_id,
        sqlc.arg(secret_ciphertext),
        sqlc.arg(totp_timestep)
    FROM enrollment
    ON CONFLICT (org_user_id) DO NOTHING
    RETURNING org_user_id
), consumed AS (
    UPDATE vetchium.org_totp_enrollments
    SET consumed_at = now(),
        active = false
    WHERE org_totp_enrollment_id IN (
        SELECT org_totp_enrollment_id FROM enrollment
    )
      AND EXISTS (SELECT 1 FROM enabled)
    RETURNING org_user_id
), deleted_codes AS (
    DELETE FROM vetchium.org_totp_recovery_codes
    WHERE org_user_id IN (SELECT org_user_id FROM enabled)
), inserted_codes AS (
    INSERT INTO vetchium.org_totp_recovery_codes (org_user_id, code_hash)
    SELECT e.org_user_id, code_hash
    FROM enabled AS e
    CROSS JOIN unnest(sqlc.arg(recovery_code_hashes)::bytea[]) AS code_hash
    RETURNING org_user_id
), sessions AS (
    DELETE FROM vetchium.org_sessions
    WHERE org_user_id IN (SELECT org_user_id FROM enabled)
      AND org_session_id <> sqlc.arg(current_org_session_id)
), challenges AS (
    UPDATE vetchium.org_login_challenges
    SET active = false
    WHERE org_user_id IN (SELECT org_user_id FROM enabled)
      AND active
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.totp.enabled',
        'org_user',
        org_user_id::text,
        'org_user',
        org_user_id::text,
        'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('recovery_codes_created', 10)
    FROM consumed
    WHERE (SELECT count(*) FROM inserted_codes) = 10
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS confirmed;

-- name: DisableOrgTOTP :one
WITH eligible_user AS (
    SELECT u.org_user_id
    FROM vetchium.org_users AS u
    WHERE u.org_user_id = sqlc.arg(org_user_id)
      AND u.org_user_state = 'active'
), removed AS (
    DELETE FROM vetchium.org_user_totp_credentials
    WHERE org_user_id IN (SELECT org_user_id FROM eligible_user)
    RETURNING org_user_id
), codes AS (
    DELETE FROM vetchium.org_totp_recovery_codes
    WHERE org_user_id IN (SELECT org_user_id FROM removed)
), enrollments AS (
    UPDATE vetchium.org_totp_enrollments
    SET active = false
    WHERE org_user_id IN (SELECT org_user_id FROM removed)
      AND active
), challenges AS (
    UPDATE vetchium.org_login_challenges
    SET active = false
    WHERE org_user_id IN (SELECT org_user_id FROM removed)
      AND active
), sessions AS (
    DELETE FROM vetchium.org_sessions
    WHERE org_user_id IN (SELECT org_user_id FROM removed)
      AND org_session_id <> sqlc.arg(current_org_session_id)
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.totp.disabled',
        'org_user',
        org_user_id::text,
        'org_user',
        org_user_id::text,
        'orgs-api',
        jsonb_build_object('other_sessions_revoked', true)
    FROM removed
)
SELECT EXISTS (SELECT 1 FROM eligible_user) AS user_active;

-- name: OrgTOTPEnabled :one
SELECT EXISTS (
    SELECT 1 FROM vetchium.org_user_totp_credentials AS t
    WHERE t.org_user_id = u.org_user_id
) AS enabled
FROM vetchium.org_users AS u
WHERE u.org_user_id = $1
  AND u.org_user_state = 'active';

-- name: RegenerateOrgTOTPRecoveryCodes :one
WITH eligible_user AS (
    SELECT u.org_user_id
    FROM vetchium.org_users AS u
    JOIN vetchium.org_user_totp_credentials AS t USING (org_user_id)
    WHERE u.org_user_id = sqlc.arg(org_user_id)
      AND u.org_user_state = 'active'
    FOR UPDATE OF u
), deleted_codes AS (
    DELETE FROM vetchium.org_totp_recovery_codes
    WHERE org_user_id IN (SELECT org_user_id FROM eligible_user)
), inserted_codes AS (
    INSERT INTO vetchium.org_totp_recovery_codes (org_user_id, code_hash)
    SELECT u.org_user_id, code_hash
    FROM eligible_user AS u
    CROSS JOIN unnest(sqlc.arg(recovery_code_hashes)::bytea[]) AS code_hash
    RETURNING org_user_id
), sessions AS (
    DELETE FROM vetchium.org_sessions
    WHERE org_user_id IN (SELECT org_user_id FROM eligible_user)
      AND org_session_id <> sqlc.arg(current_org_session_id)
), challenges AS (
    UPDATE vetchium.org_login_challenges
    SET active = false
    WHERE org_user_id IN (SELECT org_user_id FROM eligible_user)
      AND active
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.totp.recovery-codes-regenerated',
        'org_user',
        org_user_id::text,
        'org_user',
        org_user_id::text,
        'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('recovery_codes_created', 10)
    FROM eligible_user
    WHERE (SELECT count(*) FROM inserted_codes) = 10
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS regenerated;
