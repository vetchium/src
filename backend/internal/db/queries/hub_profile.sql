-- name: GetHubMyInfo :one
SELECT
    u.hub_user_did,
    u.handle,
    u.email_address,
    u.display_name,
    u.preferred_language,
    u.resident_country,
    u.preferred_job_countries,
    u.totp_enabled,
    recovery.remaining_codes AS recovery_codes_remaining,
    s.authenticated_at,
    u.agencies_may_message,
    u.ideal_job,
    u.looking_for_job,
    (u.job_search_prompt_dismissed_at IS NOT NULL)::boolean
        AS job_search_prompt_dismissed
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

-- The ideal job an application snapshot freezes (HP-APP-002); whether the
-- user is looking for a job never leaves with it (PROF-JOB-004).
-- name: GetHubIdealJob :one
SELECT u.ideal_job
FROM vetchium.hub_users AS u
WHERE u.hub_user_did = sqlc.arg(hub_user_did)
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

-- name: SetHubPreferredJobCountries :one
WITH updated AS (
    UPDATE vetchium.hub_users
    SET preferred_job_countries = sqlc.arg(preferred_job_countries),
        updated_at = now()
    WHERE hub_user_did = sqlc.arg(hub_user_did)
      AND hub_user_state = 'active'
    RETURNING hub_user_did, preferred_job_countries
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.profile.preferred-job-countries-set',
        'hub_user',
        hub_user_did::text,
        'hub_user',
        hub_user_did::text,
        'hub-api',
        jsonb_build_object('preferred_job_countries', preferred_job_countries)
    FROM updated
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS changed;

-- name: SetHubIdealJob :one
WITH updated AS (
    UPDATE vetchium.hub_users
    SET ideal_job = NULLIF(sqlc.arg(ideal_job)::text, ''),
        updated_at = now()
    WHERE hub_user_did = sqlc.arg(hub_user_did)
      AND hub_user_state = 'active'
    RETURNING hub_user_did, ideal_job
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.profile.ideal-job-set',
        'hub_user',
        hub_user_did::text,
        'hub_user',
        hub_user_did::text,
        'hub-api',
        -- PROF-JOB-003: whether one is set, never the text.
        jsonb_build_object('ideal_job_set', ideal_job IS NOT NULL)
    FROM updated
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS changed;

-- name: SetHubLookingForJob :one
WITH updated AS (
    UPDATE vetchium.hub_users
    SET looking_for_job = sqlc.arg(looking_for_job),
        updated_at = now()
    WHERE hub_user_did = sqlc.arg(hub_user_did)
      AND hub_user_state = 'active'
    RETURNING hub_user_did, looking_for_job
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.profile.looking-for-job-set',
        'hub_user',
        hub_user_did::text,
        'hub_user',
        hub_user_did::text,
        'hub-api',
        jsonb_build_object('looking_for_job', looking_for_job)
    FROM updated
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS changed;

-- name: DismissHubJobSearchPrompt :one
WITH updated AS (
    UPDATE vetchium.hub_users
    SET job_search_prompt_dismissed_at =
            coalesce(job_search_prompt_dismissed_at, now()),
        updated_at = now()
    WHERE hub_user_did = sqlc.arg(hub_user_did)
      AND hub_user_state = 'active'
    RETURNING hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.profile.job-search-prompt-dismissed',
        'hub_user',
        hub_user_did::text,
        'hub_user',
        hub_user_did::text,
        'hub-api',
        '{}'::jsonb
    FROM updated
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS changed;
