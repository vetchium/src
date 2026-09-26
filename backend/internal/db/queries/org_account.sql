-- name: GetOrgMyInfo :one
SELECT
    u.email_address,
    u.preferred_language,
    o.display_name,
    o.org_state,
    d.domain,
    d.domain_state,
    d.verification_token,
    d.last_verified_at,
    d.failing_since,
    ARRAY(
        SELECT ep.permission
        FROM vetchium.org_effective_permissions AS ep
        WHERE ep.org_user_id = u.org_user_id
        ORDER BY ep.permission
    )::text [] AS permissions
FROM vetchium.org_users AS u
JOIN vetchium.orgs AS o ON o.org_did = u.org_did
JOIN vetchium.org_domains AS d ON d.org_did = o.org_did
WHERE u.org_user_id = sqlc.arg(org_user_id)
  AND u.org_user_state = 'active';

-- name: OrgUserHoldsPermission :one
SELECT EXISTS (
    SELECT 1
    FROM vetchium.org_effective_permissions AS ep
    JOIN vetchium.org_users AS u ON u.org_user_id = ep.org_user_id
    WHERE ep.org_user_id = sqlc.arg(org_user_id)
      AND ep.permission = sqlc.arg(permission)
      AND u.org_user_state = 'active'
) AS held;
