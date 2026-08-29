-- Housekeeping deletes at most one batch per table and worker run so a large
-- backlog cannot monopolize the database. Subsequent runs drain the backlog.

-- name: PruneExpiredAdminSessions :one
WITH candidates AS MATERIALIZED (
    SELECT admin_session_id
    FROM vetchium.admin_sessions AS candidate
    WHERE expires_at <= now()
    ORDER BY expires_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1000
), deleted AS (
    DELETE FROM vetchium.admin_sessions AS session
    USING candidates
    WHERE session.admin_session_id = candidates.admin_session_id
    RETURNING session.admin_session_id
), summary AS (
    SELECT count(*)::bigint AS deleted_count FROM deleted
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.housekeeping.sessions-pruned',
        'housekeeping_batch',
        gen_random_uuid()::text,
        'worker',
        'workers',
        'workers',
        jsonb_build_object('deleted_count', deleted_count)
    FROM summary
    WHERE deleted_count > 0
)
SELECT deleted_count FROM summary;

-- name: PruneAdminLoginChallenges :one
WITH candidates AS MATERIALIZED (
    SELECT admin_login_challenge_id
    FROM vetchium.admin_login_challenges AS candidate
    WHERE expires_at <= now() OR consumed_at IS NOT NULL
    ORDER BY COALESCE(consumed_at, expires_at)
    FOR UPDATE SKIP LOCKED
    LIMIT 1000
), deleted AS (
    DELETE FROM vetchium.admin_login_challenges AS challenge
    USING candidates
    WHERE challenge.admin_login_challenge_id =
        candidates.admin_login_challenge_id
    RETURNING challenge.admin_login_challenge_id
), summary AS (
    SELECT count(*)::bigint AS deleted_count FROM deleted
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.housekeeping.login-challenges-pruned',
        'housekeeping_batch',
        gen_random_uuid()::text,
        'worker',
        'workers',
        'workers',
        jsonb_build_object('deleted_count', deleted_count)
    FROM summary
    WHERE deleted_count > 0
)
SELECT deleted_count FROM summary;

-- name: PruneAdminTOTPEnrollments :one
WITH candidates AS MATERIALIZED (
    SELECT admin_totp_enrollment_id
    FROM vetchium.admin_totp_enrollments AS candidate
    WHERE expires_at <= now() OR consumed_at IS NOT NULL
    ORDER BY COALESCE(consumed_at, expires_at)
    FOR UPDATE SKIP LOCKED
    LIMIT 1000
), deleted AS (
    DELETE FROM vetchium.admin_totp_enrollments AS enrollment
    USING candidates
    WHERE enrollment.admin_totp_enrollment_id =
        candidates.admin_totp_enrollment_id
    RETURNING enrollment.admin_totp_enrollment_id
), summary AS (
    SELECT count(*)::bigint AS deleted_count FROM deleted
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.housekeeping.totp-enrollments-pruned',
        'housekeeping_batch',
        gen_random_uuid()::text,
        'worker',
        'workers',
        'workers',
        jsonb_build_object('deleted_count', deleted_count)
    FROM summary
    WHERE deleted_count > 0
)
SELECT deleted_count FROM summary;

-- name: PruneAdminPasswordResets :one
WITH candidates AS MATERIALIZED (
    SELECT admin_password_reset_token_id
    FROM vetchium.admin_password_reset_tokens AS candidate
    WHERE expires_at <= now() OR consumed_at IS NOT NULL
    ORDER BY COALESCE(consumed_at, expires_at)
    FOR UPDATE SKIP LOCKED
    LIMIT 1000
), deleted AS (
    DELETE FROM vetchium.admin_password_reset_tokens AS reset
    USING candidates
    WHERE reset.admin_password_reset_token_id =
        candidates.admin_password_reset_token_id
    RETURNING reset.admin_password_reset_token_id
), summary AS (
    SELECT count(*)::bigint AS deleted_count FROM deleted
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.housekeeping.password-resets-pruned',
        'housekeeping_batch',
        gen_random_uuid()::text,
        'worker',
        'workers',
        'workers',
        jsonb_build_object('deleted_count', deleted_count)
    FROM summary
    WHERE deleted_count > 0
)
SELECT deleted_count FROM summary;

-- name: PruneAdminInvitations :one
WITH candidates AS MATERIALIZED (
    SELECT admin_invitation_id
    FROM vetchium.admin_invitations AS candidate
    WHERE expires_at <= now() OR consumed_at IS NOT NULL
    ORDER BY COALESCE(consumed_at, expires_at)
    FOR UPDATE SKIP LOCKED
    LIMIT 1000
), deleted AS (
    DELETE FROM vetchium.admin_invitations AS invitation
    USING candidates
    WHERE invitation.admin_invitation_id = candidates.admin_invitation_id
    RETURNING invitation.admin_invitation_id
), summary AS (
    SELECT count(*)::bigint AS deleted_count FROM deleted
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.housekeeping.invitations-pruned',
        'housekeeping_batch',
        gen_random_uuid()::text,
        'worker',
        'workers',
        'workers',
        jsonb_build_object('deleted_count', deleted_count)
    FROM summary
    WHERE deleted_count > 0
)
SELECT deleted_count FROM summary;

-- name: PruneConsumedAdminTOTPRecoveryCodes :one
WITH candidates AS MATERIALIZED (
    SELECT admin_user_id, code_hash
    FROM vetchium.admin_totp_recovery_codes AS candidate
    WHERE consumed_at IS NOT NULL
    ORDER BY consumed_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1000
), deleted AS (
    DELETE FROM vetchium.admin_totp_recovery_codes AS recovery_code
    USING candidates
    WHERE recovery_code.admin_user_id = candidates.admin_user_id
      AND recovery_code.code_hash = candidates.code_hash
    RETURNING recovery_code.admin_user_id
), summary AS (
    SELECT count(*)::bigint AS deleted_count FROM deleted
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.housekeeping.recovery-codes-pruned',
        'housekeeping_batch',
        gen_random_uuid()::text,
        'worker',
        'workers',
        'workers',
        jsonb_build_object('deleted_count', deleted_count)
    FROM summary
    WHERE deleted_count > 0
)
SELECT deleted_count FROM summary;

-- Outbox ciphertext is retained no longer than the maximum usable lifetime of
-- the credential it contains, whether delivery succeeded or not.
-- name: PruneAdminEmailOutbox :one
WITH candidates AS MATERIALIZED (
    SELECT admin_email_outbox_id
    FROM vetchium.admin_email_outbox AS candidate
    WHERE
        (kind = 'password-reset' AND created_at <= now() - interval '30 minutes')
        OR (kind = 'invitation' AND created_at <= now() - interval '24 hours')
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1000
), deleted AS (
    DELETE FROM vetchium.admin_email_outbox AS outbox
    USING candidates
    WHERE outbox.admin_email_outbox_id = candidates.admin_email_outbox_id
    RETURNING outbox.admin_email_outbox_id
), summary AS (
    SELECT count(*)::bigint AS deleted_count FROM deleted
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.housekeeping.email-outbox-pruned',
        'housekeeping_batch',
        gen_random_uuid()::text,
        'worker',
        'workers',
        'workers',
        jsonb_build_object('deleted_count', deleted_count)
    FROM summary
    WHERE deleted_count > 0
)
SELECT deleted_count FROM summary;
