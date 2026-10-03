-- Keyset-paginated member list. The sort key is the address, or the join date
-- with the address as tie-breaker. The permission filter matches a direct
-- grant, which is what the role label and the summary counts are built from.
-- name: ListOrgUsers :many
SELECT
    u.org_user_id,
    u.email_address,
    u.org_user_state,
    u.disabled_reason,
    u.created_at,
    u.last_login_at,
    ARRAY(
        SELECT g.permission
        FROM vetchium.org_user_permissions AS g
        WHERE g.org_user_id = u.org_user_id
        ORDER BY g.permission
    )::text[] AS granted_permissions,
    ARRAY(
        SELECT e.permission
        FROM vetchium.org_effective_permissions AS e
        WHERE e.org_user_id = u.org_user_id
        ORDER BY e.permission
    )::text[] AS effective_permissions
FROM vetchium.org_users AS u
WHERE u.org_did = sqlc.arg(org_did)
  AND u.org_user_state <> 'provisioning'
  AND (
      sqlc.narg(search)::text IS NULL
      OR strpos(u.email_address, sqlc.narg(search)::text) > 0
  )
  AND (
      sqlc.narg(state_filter)::text IS NULL
      OR (sqlc.narg(state_filter)::text = 'active'
          AND u.org_user_state = 'active')
      OR (sqlc.narg(state_filter)::text = 'disabled-manual'
          AND u.org_user_state = 'disabled' AND u.disabled_reason = 'manual')
      OR (sqlc.narg(state_filter)::text = 'disabled-nonpayment'
          AND u.org_user_state = 'disabled'
          AND u.disabled_reason = 'nonpayment')
  )
  AND (
      sqlc.narg(permission_filter)::text IS NULL
      OR EXISTS (
          SELECT 1
          FROM vetchium.org_user_permissions AS g
          WHERE g.org_user_id = u.org_user_id
            AND g.permission = sqlc.narg(permission_filter)::text
      )
  )
  AND (
      NOT sqlc.arg(no_permissions)::boolean
      OR NOT EXISTS (
          SELECT 1
          FROM vetchium.org_user_permissions AS g
          WHERE g.org_user_id = u.org_user_id
      )
  )
  AND (
      sqlc.narg(after_email_address)::text IS NULL
      OR CASE
          WHEN sqlc.arg(sort_by)::text = 'email' THEN
              CASE WHEN sqlc.arg(descending)::boolean
                  THEN u.email_address < sqlc.narg(after_email_address)::text
                  ELSE u.email_address > sqlc.narg(after_email_address)::text
              END
          ELSE
              CASE WHEN sqlc.arg(descending)::boolean
                  THEN (u.created_at, u.email_address) <
                      (sqlc.narg(after_created_at)::timestamptz,
                       sqlc.narg(after_email_address)::text)
                  ELSE (u.created_at, u.email_address) >
                      (sqlc.narg(after_created_at)::timestamptz,
                       sqlc.narg(after_email_address)::text)
              END
      END
  )
ORDER BY
    (CASE WHEN sqlc.arg(sort_by)::text = 'joined'
        AND NOT sqlc.arg(descending)::boolean THEN u.created_at END) ASC,
    (CASE WHEN sqlc.arg(sort_by)::text = 'joined'
        AND sqlc.arg(descending)::boolean THEN u.created_at END) DESC,
    (CASE WHEN NOT sqlc.arg(descending)::boolean THEN u.email_address END) ASC,
    (CASE WHEN sqlc.arg(descending)::boolean THEN u.email_address END) DESC
LIMIT sqlc.arg(page_limit);

-- name: GetOrgUserSummary :one
SELECT
    o.org_plan_oid,
    o.google_sign_in_enabled,
    vetchium.org_seats_in_use(o.org_did)::bigint AS seats_in_use,
    count(*) FILTER (WHERE u.org_user_state = 'active')::bigint
        AS active_users,
    count(*) FILTER (
        WHERE u.org_user_state = 'disabled' AND u.disabled_reason = 'manual'
    )::bigint AS disabled_manual_users,
    count(*) FILTER (
        WHERE u.org_user_state = 'disabled'
          AND u.disabled_reason = 'nonpayment'
    )::bigint AS disabled_nonpayment_users,
    count(*) FILTER (
        WHERE u.org_user_state = 'active' AND NOT EXISTS (
            SELECT 1 FROM vetchium.org_user_permissions AS g
            WHERE g.org_user_id = u.org_user_id
        )
    )::bigint AS active_users_without_permissions
FROM vetchium.orgs AS o
LEFT JOIN vetchium.org_users AS u
    ON u.org_did = o.org_did AND u.org_user_state <> 'provisioning'
WHERE o.org_did = sqlc.arg(org_did)
GROUP BY o.org_did, o.org_plan_oid, o.google_sign_in_enabled;

-- Active users holding each directly granted permission.
-- name: ListOrgPermissionCounts :many
SELECT g.permission, count(*)::bigint AS users
FROM vetchium.org_user_permissions AS g
JOIN vetchium.org_users AS u ON u.org_user_id = g.org_user_id
WHERE u.org_did = sqlc.arg(org_did)
  AND u.org_user_state = 'active'
GROUP BY g.permission
ORDER BY g.permission;

-- name: ListOrgPermissionCatalog :many
SELECT
    c.permission,
    ARRAY(
        SELECT i.implied_permission
        FROM vetchium.org_permission_implications AS i
        WHERE i.permission = c.permission
        ORDER BY i.implied_permission
    )::text[] AS implies
FROM vetchium.org_permission_catalog AS c
ORDER BY c.permission;

-- Reads the users a change targets, in request order, once the caller holds
-- the Org row lock. A missing address is simply absent from the result.
-- name: GetOrgUsersForChange :many
SELECT
    u.org_user_id,
    u.email_address,
    u.org_user_state,
    ARRAY(
        SELECT g.permission
        FROM vetchium.org_user_permissions AS g
        WHERE g.org_user_id = u.org_user_id
        ORDER BY g.permission
    )::text[] AS granted_permissions
FROM unnest(sqlc.arg(email_addresses)::text[])
    WITH ORDINALITY AS wanted(email_address, position)
JOIN vetchium.org_users AS u
    ON u.org_did = sqlc.arg(org_did)
   AND u.email_address = wanted.email_address
   AND u.org_user_state <> 'provisioning'
ORDER BY wanted.position;

-- Disables every active target, or none: the Org must keep an active
-- superadmin outside the set. Sessions and unfinished credential flows end
-- with the account.
-- name: DisableOrgUsers :one
WITH targets AS (
    SELECT u.org_user_id
    FROM vetchium.org_users AS u
    WHERE u.org_did = sqlc.arg(org_did)
      AND u.org_user_id = ANY(sqlc.arg(org_user_ids)::uuid[])
), keeps_superadmin AS (
    SELECT EXISTS (
        SELECT 1
        FROM vetchium.org_effective_permissions AS e
        JOIN vetchium.org_users AS u ON u.org_user_id = e.org_user_id
        WHERE u.org_did = sqlc.arg(org_did)
          AND e.permission = 'org:superadmin'
          AND u.org_user_state = 'active'
          AND u.org_user_id <> ALL(sqlc.arg(org_user_ids)::uuid[])
    ) AS ok
), updated AS (
    UPDATE vetchium.org_users AS u
    SET org_user_state = 'disabled',
        disabled_reason = 'manual',
        disabled_at = now(),
        disabled_by = sqlc.arg(actor_org_user_id),
        updated_at = now()
    FROM keeps_superadmin AS k
    WHERE u.org_user_id IN (SELECT org_user_id FROM targets)
      AND u.org_user_state = 'active'
      AND k.ok
    RETURNING u.org_user_id, u.email_address
), sessions AS (
    DELETE FROM vetchium.org_sessions
    WHERE org_user_id IN (SELECT org_user_id FROM updated)
), challenges AS (
    UPDATE vetchium.org_login_challenges
    SET active = false
    WHERE org_user_id IN (SELECT org_user_id FROM updated) AND active
), resets AS (
    UPDATE vetchium.org_password_reset_tokens
    SET active = false
    WHERE org_user_id IN (SELECT org_user_id FROM updated) AND active
), enrollments AS (
    UPDATE vetchium.org_totp_enrollments
    SET active = false
    WHERE org_user_id IN (SELECT org_user_id FROM updated) AND active
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.users.disabled',
        'org',
        sqlc.arg(org_did)::text,
        'org_user',
        sqlc.arg(actor_org_user_id)::text,
        'orgs-api',
        jsonb_build_object(
            'email_addresses', changed.email_addresses,
            'reason', 'manual',
            'sessions_revoked', true
        )
    FROM (
        SELECT jsonb_agg(u.email_address ORDER BY u.email_address)
            AS email_addresses
        FROM updated AS u
        HAVING count(*) > 0
    ) AS changed
)
SELECT CASE
    WHEN NOT (SELECT ok FROM keeps_superadmin) THEN 'last-superadmin'
    ELSE 'ok'
END::text AS result;

-- Re-enables disabled targets (either reason) when the whole batch fits the
-- cap; seat_limit is NULL for an unlimited Org.
-- name: EnableOrgUsers :one
WITH disabled AS (
    SELECT u.org_user_id
    FROM vetchium.org_users AS u
    WHERE u.org_did = sqlc.arg(org_did)
      AND u.org_user_id = ANY(sqlc.arg(org_user_ids)::uuid[])
      AND u.org_user_state = 'disabled'
), fits AS (
    SELECT (
        sqlc.narg(seat_limit)::integer IS NULL
        OR vetchium.org_seats_in_use(sqlc.arg(org_did))
            + (SELECT count(*) FROM disabled) <= sqlc.narg(seat_limit)::integer
    ) AS ok
), updated AS (
    UPDATE vetchium.org_users AS u
    SET org_user_state = 'active',
        disabled_reason = NULL,
        disabled_at = NULL,
        disabled_by = NULL,
        updated_at = now()
    FROM fits
    WHERE u.org_user_id IN (SELECT org_user_id FROM disabled) AND fits.ok
    RETURNING u.org_user_id, u.email_address
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.users.enabled',
        'org',
        sqlc.arg(org_did)::text,
        'org_user',
        sqlc.arg(actor_org_user_id)::text,
        'orgs-api',
        jsonb_build_object('email_addresses', changed.email_addresses)
    FROM (
        SELECT jsonb_agg(u.email_address ORDER BY u.email_address)
            AS email_addresses
        FROM updated AS u
        HAVING count(*) > 0
    ) AS changed
)
SELECT CASE
    WHEN NOT (SELECT ok FROM fits) THEN 'limit-reached'
    ELSE 'ok'
END::text AS result;

-- Replaces the direct grants of every target with one set. After the change
-- the Org must still have an active superadmin: one outside the set, or a
-- target that keeps the grant.
-- name: SetOrgUserPermissions :one
WITH targets AS (
    SELECT u.org_user_id, u.org_user_state
    FROM vetchium.org_users AS u
    WHERE u.org_did = sqlc.arg(org_did)
      AND u.org_user_id = ANY(sqlc.arg(org_user_ids)::uuid[])
), keeps_superadmin AS (
    SELECT (
        EXISTS (
            SELECT 1
            FROM vetchium.org_effective_permissions AS e
            JOIN vetchium.org_users AS u ON u.org_user_id = e.org_user_id
            WHERE u.org_did = sqlc.arg(org_did)
              AND e.permission = 'org:superadmin'
              AND u.org_user_state = 'active'
              AND u.org_user_id <> ALL(sqlc.arg(org_user_ids)::uuid[])
        )
        OR (
            'org:superadmin' = ANY(sqlc.arg(permissions)::text[])
            AND EXISTS (
                SELECT 1 FROM targets WHERE org_user_state = 'active'
            )
        )
    ) AS ok
), deleted AS (
    -- Sibling data-modifying CTEs run in no guaranteed order, so the two
    -- writes never touch the same key: drop only grants that go, add only
    -- grants that are new, and leave the ones that stay alone.
    DELETE FROM vetchium.org_user_permissions AS p
    WHERE p.org_user_id IN (SELECT org_user_id FROM targets)
      AND p.permission <> ALL(sqlc.arg(permissions)::text[])
      AND (SELECT ok FROM keeps_superadmin)
), inserted AS (
    INSERT INTO vetchium.org_user_permissions (org_user_id, permission)
    SELECT t.org_user_id, requested.permission
    FROM targets AS t
    CROSS JOIN unnest(sqlc.arg(permissions)::text[]) AS requested(permission)
    WHERE (SELECT ok FROM keeps_superadmin)
    ON CONFLICT (org_user_id, permission) DO NOTHING
    RETURNING org_user_id
), touched AS (
    UPDATE vetchium.org_users AS u
    SET updated_at = now()
    WHERE u.org_user_id IN (SELECT org_user_id FROM targets)
      AND (SELECT ok FROM keeps_superadmin)
    RETURNING u.email_address
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.users.permissions_set',
        'org',
        sqlc.arg(org_did)::text,
        'org_user',
        sqlc.arg(actor_org_user_id)::text,
        'orgs-api',
        jsonb_build_object(
            'email_addresses', changed.email_addresses,
            'permissions', to_jsonb(sqlc.arg(permissions)::text[])
        )
    FROM (
        SELECT jsonb_agg(t.email_address ORDER BY t.email_address)
            AS email_addresses
        FROM touched AS t
        HAVING count(*) > 0
    ) AS changed
)
SELECT CASE
    WHEN NOT (SELECT ok FROM keeps_superadmin) THEN 'last-superadmin'
    ELSE 'ok'
END::text AS result;
