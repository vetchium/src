-- name: CreateHubSignupRequest :one
WITH allowed_domain AS (
    SELECT 1
    FROM vetchium.hub_signup_domains
    WHERE domain = sqlc.arg(email_domain)
      AND hub_signup_domain_state = 'active'
), existing_user AS (
    SELECT 1
    FROM vetchium.hub_users AS u
    WHERE u.email_address = sqlc.arg(email_address)
), upserted AS (
    INSERT INTO vetchium.hub_signup_requests (
        hub_signup_request_id,
        email_address,
        display_name,
        preferred_language,
        resident_country,
        token_hash,
        expires_at
    )
    SELECT
        sqlc.arg(hub_signup_request_id),
        sqlc.arg(email_address),
        sqlc.arg(display_name),
        sqlc.arg(preferred_language),
        sqlc.arg(resident_country),
        sqlc.arg(token_hash),
        sqlc.arg(expires_at)
    WHERE EXISTS (SELECT 1 FROM allowed_domain)
      AND NOT EXISTS (SELECT 1 FROM existing_user)
    ON CONFLICT (email_address) WHERE active DO UPDATE
    SET hub_signup_request_id = EXCLUDED.hub_signup_request_id,
        display_name = EXCLUDED.display_name,
        preferred_language = EXCLUDED.preferred_language,
        resident_country = EXCLUDED.resident_country,
        token_hash = EXCLUDED.token_hash,
        created_at = now(),
        expires_at = EXCLUDED.expires_at,
        consumed_at = NULL,
        active = true
    RETURNING hub_signup_request_id
), outbox AS (
    INSERT INTO vetchium.hub_email_outbox (
        kind,
        recipient_email_address,
        preferred_language,
        payload_ciphertext
    )
    SELECT
        'signup',
        sqlc.arg(email_address),
        sqlc.arg(preferred_language),
        sqlc.arg(payload_ciphertext)
    FROM upserted
    RETURNING hub_email_outbox_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id,
        action,
        entity_type,
        entity_id,
        actor_type,
        source,
        idempotency_key,
        payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.signup.requested',
        'hub_signup_request',
        hub_signup_request_id::text,
        'anonymous',
        'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object(
            'preferred_language', sqlc.arg(preferred_language)::text,
            'resident_country', sqlc.arg(resident_country)::text,
            'email_queued', EXISTS (SELECT 1 FROM outbox)
        )
    FROM upserted
)
SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM allowed_domain) THEN 'domain_not_allowed'
    ELSE 'accepted'
END::text AS result;

-- name: ResolveHubSignupForCompletion :one
SELECT
    hub_signup_request_id,
    email_address,
    display_name,
    preferred_language,
    resident_country
FROM vetchium.hub_signup_requests
WHERE token_hash = sqlc.arg(token_hash)
  AND active
  AND consumed_at IS NULL
  AND expires_at > now()
FOR UPDATE;

-- name: CompleteHubSignup :one
WITH eligible_signup AS (
    SELECT s.hub_signup_request_id, s.email_address, s.display_name,
        s.preferred_language, s.resident_country
    FROM vetchium.hub_signup_requests AS s
    WHERE s.hub_signup_request_id = sqlc.arg(hub_signup_request_id)
      AND s.active
      AND s.consumed_at IS NULL
      AND s.expires_at > now()
      AND NOT EXISTS (
          SELECT 1
          FROM vetchium.hub_users AS u
          WHERE u.email_address = s.email_address
      )
    FOR UPDATE
), inserted_user AS (
    INSERT INTO vetchium.hub_users (
        hub_user_did,
        handle,
        email_address,
        display_name,
        password_hash,
        preferred_language,
        resident_country
    )
    SELECT
        sqlc.arg(hub_user_did),
        sqlc.arg(handle),
        email_address,
        display_name,
        sqlc.arg(password_hash),
        preferred_language,
        resident_country
    FROM eligible_signup
    ON CONFLICT DO NOTHING
    RETURNING hub_user_did, handle
), consumed AS (
    UPDATE vetchium.hub_signup_requests
    SET consumed_at = now(),
        active = false
    WHERE hub_signup_request_id IN (
        SELECT hub_signup_request_id FROM eligible_signup
    )
      AND EXISTS (SELECT 1 FROM inserted_user)
    RETURNING hub_signup_request_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id,
        action,
        entity_type,
        entity_id,
        actor_type,
        source,
        idempotency_key,
        payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.user.created',
        'hub_user',
        hub_user_did::text,
        'anonymous',
        'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('handle', handle)
    FROM inserted_user
    WHERE EXISTS (SELECT 1 FROM consumed)
)
SELECT hub_user_did, handle
FROM inserted_user
WHERE EXISTS (SELECT 1 FROM consumed);
