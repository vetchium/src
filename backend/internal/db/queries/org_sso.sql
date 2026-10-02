-- name: CreateOrgSSOLoginState :exec
INSERT INTO vetchium.org_sso_login_states (
    state_hash, provider, domain, nonce_hash, verifier_ciphertext, expires_at
)
VALUES (
    sqlc.arg(state_hash), sqlc.arg(provider), sqlc.arg(domain),
    sqlc.arg(nonce_hash), sqlc.arg(verifier_ciphertext), sqlc.arg(expires_at)
);

-- A state redeems once and only before it expires; a replay finds nothing.
-- name: ConsumeOrgSSOLoginState :one
UPDATE vetchium.org_sso_login_states AS t
SET consumed_at = now()
WHERE t.state_hash = sqlc.arg(state_hash)
  AND t.provider = sqlc.arg(provider)
  AND t.consumed_at IS NULL
  AND t.expires_at > now()
RETURNING t.domain::text AS domain, t.nonce_hash, t.verifier_ciphertext;

-- The user a verified Google identity names, with everything the sign-in
-- decision reads. Resolved like GetOrgUserForLogin: if a released domain was
-- claimed by another local Org, the current owner wins.
-- name: GetOrgUserForSSO :one
SELECT
    u.org_user_id,
    u.org_user_state,
    u.disabled_reason,
    u.preferred_language,
    o.org_plan_oid,
    o.google_sign_in_enabled,
    COALESCE((
        SELECT i.subject
        FROM vetchium.org_user_sso_identities AS i
        WHERE i.org_user_id = u.org_user_id AND i.provider = sqlc.arg(provider)
    ), '')::text AS linked_subject,
    (
        SELECT i.org_user_id
        FROM vetchium.org_user_sso_identities AS i
        WHERE i.provider = sqlc.arg(provider) AND i.subject = sqlc.arg(subject)
    ) AS subject_owner_id
FROM vetchium.org_domains AS d
JOIN vetchium.orgs AS o ON o.org_did = d.org_did
JOIN vetchium.org_users AS u
    ON u.org_did = o.org_did
   AND u.email_address = sqlc.arg(email_address)
WHERE d.domain = sqlc.arg(domain)
  AND o.org_state IN ('active', 'suspended')
  AND u.org_user_state IN ('active', 'disabled')
ORDER BY (d.domain_state = 'released'), d.created_at DESC
LIMIT 1;

-- Links the subject on first use, then signs in. Every condition is read
-- again here, so a plan change, a disablement or a competing link that lands
-- after GetOrgUserForSSO leaves no row. The Google sign-in skips Vetchium
-- TOTP by design (D23), which is why this does not use CreateOrgSession.
-- name: CreateOrgSSOSession :one
WITH eligible AS (
    SELECT u.org_user_id
    FROM vetchium.org_users AS u
    JOIN vetchium.orgs AS o ON o.org_did = u.org_did
    WHERE u.org_user_id = sqlc.arg(org_user_id)
      AND u.org_user_state = 'active'
      AND o.org_state IN ('active', 'suspended')
      AND o.org_plan_oid = 'org-gold-tier'
      AND o.google_sign_in_enabled
    FOR UPDATE OF u
), linked AS (
    INSERT INTO vetchium.org_user_sso_identities (org_user_id, provider, subject)
    SELECT org_user_id, sqlc.arg(provider), sqlc.arg(subject)
    FROM eligible
    ON CONFLICT (org_user_id, provider) DO UPDATE
    SET last_used_at = now()
    WHERE org_user_sso_identities.subject = EXCLUDED.subject
    RETURNING org_user_id
), updated_user AS (
    UPDATE vetchium.org_users AS u
    SET last_login_at = now(),
        updated_at = now()
    FROM linked
    WHERE u.org_user_id = linked.org_user_id
    RETURNING u.org_user_id
), session AS (
    INSERT INTO vetchium.org_sessions (
        session_token_hash,
        org_user_id,
        expires_at,
        authenticated_at
    )
    SELECT
        sqlc.arg(session_token_hash),
        org_user_id,
        sqlc.arg(expires_at),
        now()
    FROM updated_user
    RETURNING org_session_id, org_user_id, created_at, expires_at,
        authenticated_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.session.created',
        'org_session',
        org_session_id::text,
        'org_user',
        org_user_id::text,
        'orgs-api',
        jsonb_build_object('method', sqlc.arg(provider)::text)
    FROM session
)
SELECT org_session_id, created_at, expires_at, authenticated_at
FROM session;

-- name: LockOrgForGoogleSignIn :one
SELECT
    o.org_plan_oid, o.scheduled_org_plan_oid, o.google_sign_in_enabled
FROM vetchium.orgs AS o
WHERE o.org_did = sqlc.arg(org_did)
  AND o.org_state = 'active'
FOR UPDATE OF o;

-- name: SetOrgGoogleSignIn :exec
WITH changed AS (
    UPDATE vetchium.orgs AS o
    SET google_sign_in_enabled = sqlc.arg(enabled)::boolean,
        updated_at = now()
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.google_sign_in_enabled <> sqlc.arg(enabled)::boolean
    RETURNING o.org_did
)
INSERT INTO vetchium.audit_events (
    tenant_id, action, entity_type, entity_id, actor_type, actor_id,
    source, payload
)
SELECT
    sqlc.arg(tenant_id),
    CASE WHEN sqlc.arg(enabled)::boolean
        THEN 'org.google_sign_in.enabled'
        ELSE 'org.google_sign_in.disabled'
    END,
    'org',
    changed.org_did::text,
    'org_user',
    sqlc.arg(actor_id)::text,
    'orgs-api',
    '{}'::jsonb
FROM changed;
