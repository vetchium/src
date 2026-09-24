-- name: SupersedeHubEmailChangeChallenges :execrows
-- Call before IssueHubEmailChangeChallenge in the same transaction.
-- Sibling data-modifying CTEs cannot reliably vacate the active-user index.
UPDATE vetchium.hub_email_change_challenges AS old
SET superseded_at = now()
WHERE old.hub_user_did = sqlc.arg(hub_user_did)
  AND old.consumed_at IS NULL
  AND old.superseded_at IS NULL
  AND old.attempt_count < 5;

-- name: IssueHubEmailChangeChallenge :one
-- An address that already belongs to an account still gets a challenge, so
-- rate limits and the response are identical, but no code is queued for it.
WITH account AS (
    SELECT u.hub_user_did, u.preferred_language
    FROM vetchium.hub_users AS u
    JOIN vetchium.hub_sessions AS s USING (hub_user_did)
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND s.hub_session_id = sqlc.arg(hub_session_id)
      AND u.hub_user_state = 'active'
    FOR UPDATE OF u
), existing_user AS (
    SELECT 1
    FROM vetchium.hub_users AS taken
    WHERE taken.email_address = sqlc.arg(new_email_address)
), eligible AS (
    SELECT a.hub_user_did, a.preferred_language
    FROM account AS a
    WHERE NOT EXISTS (
          SELECT 1
          FROM vetchium.hub_email_change_challenges AS recent
          WHERE recent.hub_user_did = a.hub_user_did
            AND recent.created_at > now() - interval '60 seconds'
      )
      AND (
          SELECT count(*)
          FROM vetchium.hub_email_change_challenges AS hourly
          WHERE hourly.hub_user_did = a.hub_user_did
            AND hourly.created_at > now() - interval '1 hour'
      ) < 5
), inserted AS (
    INSERT INTO vetchium.hub_email_change_challenges (
        challenge_id, hub_user_did, hub_session_id, new_email_address,
        code_hash, expires_at
    )
    SELECT
        sqlc.arg(challenge_id),
        hub_user_did,
        sqlc.arg(hub_session_id),
        sqlc.arg(new_email_address),
        sqlc.arg(code_hash),
        now() + interval '10 minutes'
    FROM eligible
    RETURNING challenge_id, hub_user_did, expires_at
), outbox AS (
    INSERT INTO vetchium.hub_email_outbox (
        kind, recipient_email_address, preferred_language, payload_ciphertext
    )
    SELECT
        'email-change-verification',
        sqlc.arg(new_email_address),
        e.preferred_language,
        sqlc.arg(payload_ciphertext)
    FROM eligible AS e
    WHERE EXISTS (SELECT 1 FROM inserted)
      AND NOT EXISTS (SELECT 1 FROM existing_user)
    RETURNING hub_email_outbox_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.email-change.requested',
        'hub_user',
        i.hub_user_did::text,
        'hub_user',
        i.hub_user_did::text,
        'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object(
            'challenge_id', i.challenge_id::text,
            'code_queued', EXISTS (SELECT 1 FROM outbox)
        )
    FROM inserted AS i
)
SELECT
    (CASE
        WHEN NOT EXISTS (SELECT 1 FROM account) THEN 'unauthenticated'
        WHEN NOT EXISTS (SELECT 1 FROM inserted) THEN 'rate_limited'
        ELSE 'issued'
    END)::text AS result,
    (SELECT i.expires_at FROM inserted AS i)::timestamptz AS expires_at;

-- name: ConfirmHubEmailChange :one
-- A taken address fails the whole statement on hub_users_email_address_key;
-- the caller maps that unique violation to the unavailable-address problem.
WITH candidate AS (
    SELECT
        c.challenge_id,
        c.hub_user_did,
        c.new_email_address,
        c.code_hash,
        u.email_address AS previous_email_address,
        u.preferred_language
    FROM vetchium.hub_email_change_challenges AS c
    JOIN vetchium.hub_users AS u USING (hub_user_did)
    WHERE c.challenge_id = sqlc.arg(challenge_id)
      AND c.hub_user_did = sqlc.arg(hub_user_did)
      AND c.hub_session_id = sqlc.arg(hub_session_id)
      AND u.hub_user_state = 'active'
      AND c.consumed_at IS NULL
      AND c.superseded_at IS NULL
      AND c.expires_at > now()
      AND c.attempt_count < 5
    FOR UPDATE OF c, u
), attempted AS (
    UPDATE vetchium.hub_email_change_challenges AS c
    SET attempt_count = c.attempt_count + 1,
        consumed_at = CASE
            WHEN c.code_hash = sqlc.arg(code_hash) THEN now()
        END
    FROM candidate
    WHERE c.challenge_id = candidate.challenge_id
    RETURNING
        c.challenge_id,
        c.attempt_count,
        candidate.hub_user_did,
        candidate.new_email_address,
        candidate.previous_email_address,
        candidate.preferred_language,
        candidate.code_hash = sqlc.arg(code_hash) AS verified
), changed AS (
    UPDATE vetchium.hub_users AS u
    SET email_address = a.new_email_address,
        updated_at = now()
    FROM attempted AS a
    WHERE u.hub_user_did = a.hub_user_did
      AND a.verified
    RETURNING u.hub_user_did
), sessions AS (
    DELETE FROM vetchium.hub_sessions
    WHERE hub_user_did IN (SELECT hub_user_did FROM changed)
      AND hub_session_id <> sqlc.arg(hub_session_id)
), login_challenges AS (
    UPDATE vetchium.hub_login_challenges
    SET active = false
    WHERE hub_user_did IN (SELECT hub_user_did FROM changed)
      AND active
), resets AS (
    UPDATE vetchium.hub_password_reset_tokens
    SET active = false
    WHERE hub_user_did IN (SELECT hub_user_did FROM changed)
      AND active
), notice AS (
    INSERT INTO vetchium.hub_email_outbox (
        kind, recipient_email_address, preferred_language, payload_ciphertext
    )
    SELECT
        'email-changed',
        a.previous_email_address,
        a.preferred_language,
        sqlc.arg(notice_payload_ciphertext)
    FROM attempted AS a
    WHERE a.hub_user_did IN (SELECT hub_user_did FROM changed)
    RETURNING hub_email_outbox_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        CASE
            WHEN a.verified THEN 'hub.email.changed'
            ELSE 'hub.email-change.verification-failed'
        END,
        'hub_user',
        a.hub_user_did::text,
        'hub_user',
        a.hub_user_did::text,
        'hub-api',
        sqlc.arg(idempotency_key),
        CASE
            WHEN a.verified THEN jsonb_build_object(
                'challenge_id', a.challenge_id::text,
                'changed_fields', jsonb_build_array('email_address'),
                'other_sessions_revoked', true,
                'previous_address_notified', EXISTS (SELECT 1 FROM notice)
            )
            ELSE jsonb_build_object(
                'challenge_id', a.challenge_id::text,
                'attempt_count', a.attempt_count
            )
        END
    FROM attempted AS a
)
SELECT
    a.challenge_id,
    a.attempt_count,
    a.verified
FROM attempted AS a;
