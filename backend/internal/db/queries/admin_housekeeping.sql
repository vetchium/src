-- Housekeeping deletes at most one batch per table and worker run so a large
-- backlog cannot monopolize the database. Subsequent runs drain the backlog.

-- name: PruneExpiredAdminSessions :execrows
WITH candidates AS MATERIALIZED (
    SELECT admin_session_id
    FROM vetchium.admin_sessions AS candidate
    WHERE expires_at <= now()
    ORDER BY expires_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1000
)
DELETE FROM vetchium.admin_sessions AS session
USING candidates
WHERE session.admin_session_id = candidates.admin_session_id;

-- name: PruneExpiredAdminIdempotency :execrows
WITH candidates AS MATERIALIZED (
    SELECT operation, binding_id, idempotency_key
    FROM vetchium.admin_idempotency_ledger AS candidate
    WHERE expires_at <= now()
    ORDER BY expires_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1000
)
DELETE FROM vetchium.admin_idempotency_ledger AS ledger
USING candidates
WHERE ledger.operation = candidates.operation
  AND ledger.binding_id = candidates.binding_id
  AND ledger.idempotency_key = candidates.idempotency_key;

-- name: PruneAdminLoginChallenges :execrows
WITH candidates AS MATERIALIZED (
    SELECT admin_login_challenge_id
    FROM vetchium.admin_login_challenges AS candidate
    WHERE expires_at <= now() OR consumed_at IS NOT NULL
    ORDER BY COALESCE(consumed_at, expires_at)
    FOR UPDATE SKIP LOCKED
    LIMIT 1000
)
DELETE FROM vetchium.admin_login_challenges AS challenge
USING candidates
WHERE challenge.admin_login_challenge_id = candidates.admin_login_challenge_id;

-- name: PruneAdminTOTPEnrollments :execrows
WITH candidates AS MATERIALIZED (
    SELECT admin_totp_enrollment_id
    FROM vetchium.admin_totp_enrollments AS candidate
    WHERE expires_at <= now() OR consumed_at IS NOT NULL
    ORDER BY COALESCE(consumed_at, expires_at)
    FOR UPDATE SKIP LOCKED
    LIMIT 1000
)
DELETE FROM vetchium.admin_totp_enrollments AS enrollment
USING candidates
WHERE enrollment.admin_totp_enrollment_id = candidates.admin_totp_enrollment_id;

-- name: PruneAdminPasswordResets :execrows
WITH candidates AS MATERIALIZED (
    SELECT admin_password_reset_token_id
    FROM vetchium.admin_password_reset_tokens AS candidate
    WHERE expires_at <= now() OR consumed_at IS NOT NULL
    ORDER BY COALESCE(consumed_at, expires_at)
    FOR UPDATE SKIP LOCKED
    LIMIT 1000
)
DELETE FROM vetchium.admin_password_reset_tokens AS reset
USING candidates
WHERE reset.admin_password_reset_token_id = candidates.admin_password_reset_token_id;

-- name: PruneAdminInvitations :execrows
WITH candidates AS MATERIALIZED (
    SELECT admin_invitation_id
    FROM vetchium.admin_invitations AS candidate
    WHERE expires_at <= now() OR consumed_at IS NOT NULL
    ORDER BY COALESCE(consumed_at, expires_at)
    FOR UPDATE SKIP LOCKED
    LIMIT 1000
)
DELETE FROM vetchium.admin_invitations AS invitation
USING candidates
WHERE invitation.admin_invitation_id = candidates.admin_invitation_id;

-- name: PruneConsumedAdminTOTPRecoveryCodes :execrows
WITH candidates AS MATERIALIZED (
    SELECT admin_user_id, code_hash
    FROM vetchium.admin_totp_recovery_codes AS candidate
    WHERE consumed_at IS NOT NULL
    ORDER BY consumed_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1000
)
DELETE FROM vetchium.admin_totp_recovery_codes AS recovery_code
USING candidates
WHERE recovery_code.admin_user_id = candidates.admin_user_id
  AND recovery_code.code_hash = candidates.code_hash;

-- Outbox ciphertext is retained no longer than the maximum usable lifetime of
-- the credential it contains, whether delivery succeeded or not.
-- name: PruneAdminEmailOutbox :execrows
WITH candidates AS MATERIALIZED (
    SELECT admin_email_outbox_id
    FROM vetchium.admin_email_outbox AS candidate
    WHERE
        (kind = 'password-reset' AND created_at <= now() - interval '30 minutes')
        OR (kind = 'invitation' AND created_at <= now() - interval '24 hours')
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1000
)
DELETE FROM vetchium.admin_email_outbox AS outbox
USING candidates
WHERE outbox.admin_email_outbox_id = candidates.admin_email_outbox_id;
