-- name: ListHubSignupDomains :many
SELECT
    d.hub_signup_domain_id,
    d.domain,
    d.hub_signup_domain_state,
    COALESCE(d.disabled_comment, '')::text AS disabled_comment,
    d.created_at,
    d.updated_at
FROM vetchium.hub_signup_domains AS d
WHERE (
        sqlc.narg(filter_search)::text IS NULL
        OR d.domain ILIKE '%' || sqlc.narg(filter_search)::text || '%'
    )
  AND (
        sqlc.narg(filter_state)::vetchium.hub_signup_domain_state IS NULL
        OR d.hub_signup_domain_state =
            sqlc.narg(filter_state)::vetchium.hub_signup_domain_state
    )
  AND (
        sqlc.narg(before_created_at)::timestamptz IS NULL
        OR (d.created_at, d.hub_signup_domain_id) < (
            sqlc.narg(before_created_at)::timestamptz,
            sqlc.narg(before_domain_id)::uuid
        )
    )
ORDER BY d.created_at DESC, d.hub_signup_domain_id DESC
LIMIT sqlc.arg(page_limit);

-- name: CreateHubSignupDomain :one
WITH inserted AS (
    INSERT INTO vetchium.hub_signup_domains (
        hub_signup_domain_id,
        domain,
        hub_signup_domain_state,
        disabled_comment
    ) VALUES (
        sqlc.arg(hub_signup_domain_id),
        sqlc.arg(domain),
        sqlc.arg(state),
        sqlc.narg(disabled_comment)::text
    )
    ON CONFLICT (domain) DO NOTHING
    RETURNING
        hub_signup_domain_id,
        domain,
        hub_signup_domain_state,
        disabled_comment,
        created_at,
        updated_at
)
SELECT
    CASE WHEN EXISTS (SELECT 1 FROM inserted)
        THEN 'ok' ELSE 'already_exists' END::text AS result,
    COALESCE(
        (SELECT hub_signup_domain_id FROM inserted),
        sqlc.arg(hub_signup_domain_id)::uuid
    )::uuid AS hub_signup_domain_id,
    COALESCE(
        (SELECT domain FROM inserted),
        sqlc.arg(domain)::text
    )::text AS domain,
    COALESCE(
        (SELECT hub_signup_domain_state FROM inserted),
        sqlc.arg(state)::vetchium.hub_signup_domain_state
    )::vetchium.hub_signup_domain_state AS hub_signup_domain_state,
    COALESCE(
        (SELECT disabled_comment FROM inserted),
        ''
    )::text AS disabled_comment,
    COALESCE(
        (SELECT created_at FROM inserted),
        now()
    )::timestamptz AS created_at,
    COALESCE(
        (SELECT updated_at FROM inserted),
        now()
    )::timestamptz AS updated_at;

-- name: UpdateHubSignupDomain :one
WITH target AS (
    SELECT 1
    FROM vetchium.hub_signup_domains AS d
    WHERE d.hub_signup_domain_id = sqlc.arg(target_domain_id)
), conflicting AS (
    SELECT 1
    FROM vetchium.hub_signup_domains AS d
    WHERE d.domain = sqlc.arg(target_domain)
      AND d.hub_signup_domain_id <> sqlc.arg(target_domain_id)
), updated AS (
    UPDATE vetchium.hub_signup_domains AS d
    SET domain = sqlc.arg(target_domain),
        hub_signup_domain_state = sqlc.arg(state),
        disabled_comment = sqlc.narg(disabled_comment)::text,
        updated_at = now()
    WHERE d.hub_signup_domain_id = sqlc.arg(target_domain_id)
      AND NOT EXISTS (SELECT 1 FROM conflicting)
    RETURNING
        hub_signup_domain_id,
        domain,
        hub_signup_domain_state,
        disabled_comment,
        created_at,
        updated_at
)
SELECT
    CASE
        WHEN EXISTS (SELECT 1 FROM updated) THEN 'ok'
        WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'not_found'
        ELSE 'already_exists'
    END::text AS result,
    COALESCE(
        (SELECT hub_signup_domain_id FROM updated),
        sqlc.arg(target_domain_id)::uuid
    )::uuid AS hub_signup_domain_id,
    COALESCE(
        (SELECT domain FROM updated),
        sqlc.arg(target_domain)::text
    )::text AS domain,
    COALESCE(
        (SELECT hub_signup_domain_state FROM updated),
        sqlc.arg(state)::vetchium.hub_signup_domain_state
    )::vetchium.hub_signup_domain_state AS hub_signup_domain_state,
    COALESCE(
        (SELECT disabled_comment FROM updated),
        ''
    )::text AS disabled_comment,
    COALESCE(
        (SELECT created_at FROM updated),
        now()
    )::timestamptz AS created_at,
    COALESCE(
        (SELECT updated_at FROM updated),
        now()
    )::timestamptz AS updated_at;
