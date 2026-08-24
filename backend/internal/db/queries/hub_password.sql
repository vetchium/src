-- name: CreateHubPasswordReset :one
WITH eligible_user AS (
    SELECT hub_user_did, email_address, preferred_language
    FROM vetchium.hub_users
    WHERE email_address = sqlc.arg(email_address)
      AND hub_user_state = 'active'
), reset AS (
    INSERT INTO vetchium.hub_password_reset_tokens (
        hub_user_did,
        token_hash,
        expires_at
    )
    SELECT
        hub_user_did,
        sqlc.arg(token_hash),
        sqlc.arg(expires_at)
    FROM eligible_user
    ON CONFLICT (hub_user_did) WHERE active DO UPDATE
    SET token_hash = EXCLUDED.token_hash,
        created_at = now(),
        expires_at = EXCLUDED.expires_at,
        consumed_at = NULL
    RETURNING hub_password_reset_token_id, hub_user_did
), outbox AS (
    INSERT INTO vetchium.hub_email_outbox (
        kind,
        recipient_email_address,
        preferred_language,
        payload_ciphertext
    )
    SELECT
        'password-reset',
        u.email_address,
        u.preferred_language,
        sqlc.arg(payload_ciphertext)
    FROM eligible_user AS u
    WHERE EXISTS (SELECT 1 FROM reset)
    RETURNING hub_email_outbox_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.password-reset.requested',
        'hub_password_reset',
        hub_password_reset_token_id::text,
        'anonymous',
        NULL,
        'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('email_queued', EXISTS (SELECT 1 FROM outbox))
    FROM reset
)
SELECT EXISTS (SELECT 1 FROM outbox) AS queued;

-- name: ResolveHubPasswordResetUser :one
SELECT hub_user_did
FROM vetchium.hub_password_reset_tokens
WHERE token_hash = $1
  AND active
  AND consumed_at IS NULL
  AND expires_at > now();

-- name: CompleteHubPasswordReset :one
WITH token AS (
    SELECT t.hub_password_reset_token_id, t.hub_user_did
    FROM vetchium.hub_password_reset_tokens AS t
    JOIN vetchium.hub_users AS u USING (hub_user_did)
    WHERE t.token_hash = sqlc.arg(reset_token_hash)
      AND t.active
      AND t.consumed_at IS NULL
      AND t.expires_at > now()
      AND u.hub_user_state = 'active'
    FOR UPDATE OF t
), updated AS (
    UPDATE vetchium.hub_users AS u
    SET password_hash = sqlc.arg(password_hash),
        updated_at = now()
    WHERE hub_user_did = (SELECT hub_user_did FROM token)
    RETURNING hub_user_did
), consumed AS (
    UPDATE vetchium.hub_password_reset_tokens
    SET consumed_at = now(),
        active = false
    WHERE hub_password_reset_token_id = (
        SELECT hub_password_reset_token_id FROM token
    )
      AND EXISTS (SELECT 1 FROM updated)
    RETURNING hub_password_reset_token_id, hub_user_did
), invalidated_resets AS (
    UPDATE vetchium.hub_password_reset_tokens
    SET active = false
    WHERE hub_user_did IN (SELECT hub_user_did FROM updated)
      AND active
), sessions AS (
    DELETE FROM vetchium.hub_sessions
    WHERE hub_user_did IN (SELECT hub_user_did FROM updated)
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
        'hub.password.reset',
        'hub_user',
        hub_user_did::text,
        'anonymous',
        NULL,
        'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object(
            'password_changed', true,
            'all_sessions_revoked', true
        )
    FROM consumed
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS completed;

-- name: ChangeHubPassword :one
WITH updated AS (
    UPDATE vetchium.hub_users AS u
    SET password_hash = sqlc.arg(password_hash),
        updated_at = now()
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
    RETURNING u.hub_user_did
), sessions AS (
    DELETE FROM vetchium.hub_sessions
    WHERE hub_user_did IN (SELECT hub_user_did FROM updated)
      AND hub_session_id <> sqlc.arg(current_hub_session_id)
), challenges AS (
    UPDATE vetchium.hub_login_challenges
    SET active = false
    WHERE hub_user_did IN (SELECT hub_user_did FROM updated)
      AND active
), resets AS (
    UPDATE vetchium.hub_password_reset_tokens
    SET active = false
    WHERE hub_user_did IN (SELECT hub_user_did FROM updated)
      AND active
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.password.changed',
        'hub_user',
        hub_user_did::text,
        'hub_user',
        hub_user_did::text,
        'hub-api',
        jsonb_build_object(
            'password_changed', true,
            'other_sessions_revoked', true
        )
    FROM updated
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS changed;
