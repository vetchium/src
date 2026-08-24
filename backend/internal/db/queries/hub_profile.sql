-- name: GetHubMyInfo :one
SELECT
    u.hub_user_did,
    u.handle,
    u.email_address,
    u.display_name,
    u.preferred_language,
    u.resident_country,
    u.totp_enabled,
    recovery.remaining_codes AS recovery_codes_remaining,
    s.authenticated_at
FROM vetchium.hub_sessions AS s
JOIN vetchium.hub_users AS u USING (hub_user_did)
CROSS JOIN LATERAL (
    SELECT count(*)::bigint AS remaining_codes
    FROM vetchium.hub_totp_recovery_codes AS r
    WHERE r.hub_user_did = u.hub_user_did
      AND r.consumed_at IS NULL
) AS recovery
WHERE s.hub_session_id = sqlc.arg(hub_session_id)
  AND u.hub_user_did = sqlc.arg(hub_user_did)
  AND s.expires_at > now()
  AND u.hub_user_state = 'active';

-- name: SetHubPreferredLanguage :one
WITH updated AS (
    UPDATE vetchium.hub_users
    SET preferred_language = sqlc.arg(preferred_language),
        updated_at = now()
    WHERE hub_user_did = sqlc.arg(hub_user_did)
      AND hub_user_state = 'active'
    RETURNING hub_user_did, preferred_language
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.profile.preferred-language-set',
        'hub_user',
        hub_user_did::text,
        'hub_user',
        hub_user_did::text,
        'hub-api',
        jsonb_build_object('preferred_language', preferred_language)
    FROM updated
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS changed;

-- name: SetHubResidentCountry :one
WITH updated AS (
    UPDATE vetchium.hub_users
    SET resident_country = sqlc.arg(resident_country),
        updated_at = now()
    WHERE hub_user_did = sqlc.arg(hub_user_did)
      AND hub_user_state = 'active'
    RETURNING hub_user_did, resident_country
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.profile.resident-country-set',
        'hub_user',
        hub_user_did::text,
        'hub_user',
        hub_user_did::text,
        'hub-api',
        jsonb_build_object('resident_country', resident_country)
    FROM updated
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS changed;
