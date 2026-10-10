-- name: CreateOrgPasswordReset :one
WITH eligible_user AS (
    SELECT u.org_user_id, u.email_address, u.preferred_language
    FROM vetchium.org_domains AS d
    JOIN vetchium.orgs AS o ON o.org_did = d.org_did
    JOIN vetchium.org_users AS u
        ON u.org_did = o.org_did
       AND u.email_address = sqlc.arg(email_address)
    WHERE d.domain = sqlc.arg(domain)
      AND o.org_state IN ('active', 'suspended')
      AND u.org_user_state = 'active'
    ORDER BY (d.domain_state = 'released'), d.created_at DESC
    LIMIT 1
), reset AS (
    INSERT INTO vetchium.org_password_reset_tokens (
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
    RETURNING org_password_reset_token_id, org_user_id
), outbox AS (
    INSERT INTO vetchium.org_email_outbox (
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
    RETURNING org_email_outbox_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        subject_org_user_ids, tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT ARRAY[org_user_id],
        sqlc.arg(tenant_id),
        'org.password-reset.requested',
        'org_password_reset',
        org_password_reset_token_id::text,
        'anonymous',
        NULL,
        'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('email_queued', EXISTS (SELECT 1 FROM outbox))
    FROM reset
)
SELECT EXISTS (SELECT 1 FROM outbox) AS queued;

-- name: ResolveOrgPasswordResetUser :one
SELECT org_user_id
FROM vetchium.org_password_reset_tokens
WHERE token_hash = $1
  AND active
  AND consumed_at IS NULL
  AND expires_at > now();

-- name: CompleteOrgPasswordReset :one
WITH token AS (
    SELECT t.org_password_reset_token_id, t.org_user_id
    FROM vetchium.org_password_reset_tokens AS t
    JOIN vetchium.org_users AS u USING (org_user_id)
    WHERE t.token_hash = sqlc.arg(reset_token_hash)
      AND t.active
      AND t.consumed_at IS NULL
      AND t.expires_at > now()
      AND u.org_user_state = 'active'
    FOR UPDATE OF t
), updated AS (
    UPDATE vetchium.org_user_passwords AS p
    SET password_hash = sqlc.arg(password_hash),
        updated_at = now()
    WHERE p.org_user_id = (SELECT org_user_id FROM token)
    RETURNING p.org_user_id
), consumed AS (
    UPDATE vetchium.org_password_reset_tokens
    SET consumed_at = now(),
        active = false
    WHERE org_password_reset_token_id = (
        SELECT org_password_reset_token_id FROM token
    )
      AND EXISTS (SELECT 1 FROM updated)
    RETURNING org_password_reset_token_id, org_user_id
), invalidated_resets AS (
    UPDATE vetchium.org_password_reset_tokens
    SET active = false
    WHERE org_user_id IN (SELECT org_user_id FROM updated)
      AND active
), sessions AS (
    DELETE FROM vetchium.org_sessions
    WHERE org_user_id IN (SELECT org_user_id FROM updated)
), challenges AS (
    UPDATE vetchium.org_login_challenges
    SET active = false
    WHERE org_user_id IN (SELECT org_user_id FROM updated)
      AND active
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.password.reset',
        'org_user',
        org_user_id::text,
        'anonymous',
        NULL,
        'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object(
            'password_changed', true,
            'all_sessions_revoked', true
        )
    FROM consumed
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS completed;

-- name: ChangeOrgPassword :one
WITH updated AS (
    UPDATE vetchium.org_user_passwords AS p
    SET password_hash = sqlc.arg(password_hash),
        updated_at = now()
    FROM vetchium.org_users AS u
    WHERE p.org_user_id = sqlc.arg(org_user_id)
      AND u.org_user_id = p.org_user_id
      AND u.org_user_state = 'active'
    RETURNING p.org_user_id
), sessions AS (
    DELETE FROM vetchium.org_sessions
    WHERE org_user_id IN (SELECT org_user_id FROM updated)
      AND org_session_id <> sqlc.arg(current_org_session_id)
), challenges AS (
    UPDATE vetchium.org_login_challenges
    SET active = false
    WHERE org_user_id IN (SELECT org_user_id FROM updated)
      AND active
), resets AS (
    UPDATE vetchium.org_password_reset_tokens
    SET active = false
    WHERE org_user_id IN (SELECT org_user_id FROM updated)
      AND active
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.password.changed',
        'org_user',
        org_user_id::text,
        'org_user',
        org_user_id::text,
        'orgs-api',
        jsonb_build_object(
            'password_changed', true,
            'other_sessions_revoked', true
        )
    FROM updated
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS changed;
