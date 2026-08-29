-- name: CreateAdminPasswordReset :one
WITH eligible_user AS (
    SELECT admin_user_id, email_address
    FROM vetchium.admin_users
    WHERE email_address = sqlc.arg(request_email_address)
      AND admin_user_state = 'active'
), inserted AS (
    INSERT INTO vetchium.admin_password_reset_tokens (
        admin_user_id,
        token_hash,
        expires_at
    )
    SELECT
        admin_user_id,
        sqlc.arg(token_hash),
        sqlc.arg(expires_at)
    FROM eligible_user
    ON CONFLICT (admin_user_id) WHERE active DO UPDATE
    SET token_hash = EXCLUDED.token_hash,
        created_at = now(),
        expires_at = EXCLUDED.expires_at,
        consumed_at = NULL
    RETURNING admin_password_reset_token_id, admin_user_id
), outbox AS (
    INSERT INTO vetchium.admin_email_outbox (
        kind,
        recipient_email_address,
        payload_ciphertext
    )
    SELECT
        'password-reset',
        email_address,
        sqlc.arg(payload_ciphertext)
    FROM eligible_user
    WHERE EXISTS (SELECT 1 FROM inserted)
    RETURNING admin_email_outbox_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.password-reset.requested',
        'admin_password_reset',
        admin_password_reset_token_id::text,
        'anonymous',
        NULL,
        'admin-api',
        jsonb_build_object('email_queued', EXISTS (SELECT 1 FROM outbox))
    FROM inserted
)
SELECT EXISTS (SELECT 1 FROM outbox) AS queued;

-- name: ResolveAdminPasswordResetUser :one
SELECT t.admin_user_id
FROM vetchium.admin_password_reset_tokens AS t
WHERE t.token_hash = sqlc.arg(reset_token_hash)
  AND t.active
  AND t.consumed_at IS NULL
  AND t.expires_at > now();

-- name: CompleteAdminPasswordReset :one
WITH token AS (
    SELECT t.admin_password_reset_token_id, t.admin_user_id
    FROM vetchium.admin_password_reset_tokens AS t
    JOIN vetchium.admin_users AS u USING (admin_user_id)
    WHERE t.token_hash = sqlc.arg(reset_token_hash)
      AND t.active
      AND t.consumed_at IS NULL
      AND t.expires_at > now()
      AND u.admin_user_state = 'active'
    FOR UPDATE OF t
), updated AS (
    UPDATE vetchium.admin_users AS u
    SET password_hash = sqlc.arg(password_hash),
        updated_at = now()
    WHERE admin_user_id = (SELECT admin_user_id FROM token)
    RETURNING admin_user_id
), consumed AS (
    UPDATE vetchium.admin_password_reset_tokens
    SET consumed_at = now(),
        active = false
    WHERE admin_password_reset_token_id = (
        SELECT admin_password_reset_token_id FROM token
    )
      AND EXISTS (SELECT 1 FROM updated)
    RETURNING admin_user_id
), invalidated_resets AS (
    UPDATE vetchium.admin_password_reset_tokens
    SET active = false
    WHERE admin_user_id IN (SELECT admin_user_id FROM updated)
      AND active
), sessions AS (
    DELETE FROM vetchium.admin_sessions
    WHERE admin_user_id IN (SELECT admin_user_id FROM updated)
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
        'admin.password.reset',
        'admin_user',
        admin_user_id::text,
        'anonymous',
        NULL,
        'admin-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object(
            'password_changed', true,
            'all_sessions_revoked', true
        )
    FROM consumed
)
SELECT EXISTS (SELECT 1 FROM consumed) AS completed;

-- name: ChangeAdminPassword :one
WITH updated AS (
    UPDATE vetchium.admin_users AS u
    SET password_hash = sqlc.arg(password_hash),
        updated_at = now()
    WHERE u.admin_user_id = sqlc.arg(target_admin_user_id)
      AND u.admin_user_state = 'active'
    RETURNING u.admin_user_id
), sessions AS (
    DELETE FROM vetchium.admin_sessions
    WHERE admin_user_id IN (SELECT admin_user_id FROM updated)
      AND admin_session_id <> sqlc.arg(current_admin_session_id)
), challenges AS (
    UPDATE vetchium.admin_login_challenges
    SET active = false
    WHERE admin_user_id IN (SELECT admin_user_id FROM updated)
      AND active
), resets AS (
    UPDATE vetchium.admin_password_reset_tokens
    SET active = false
    WHERE admin_user_id IN (SELECT admin_user_id FROM updated)
      AND active
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'admin.password.changed',
        'admin_user',
        admin_user_id::text,
        'admin',
        admin_user_id::text,
        'admin-api',
        jsonb_build_object(
            'password_changed', true,
            'other_sessions_revoked', true
        )
    FROM updated
)
SELECT EXISTS (SELECT 1 FROM updated) AS changed;
