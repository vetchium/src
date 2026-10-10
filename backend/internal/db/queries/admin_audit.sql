-- name: ListAdminAuditEvents :many
WITH hub_targets AS (
    SELECT h.hub_user_did
    FROM vetchium.hub_users AS h
    WHERE (sqlc.narg(hub_handle)::text IS NULL
            OR h.handle = sqlc.narg(hub_handle))
      AND (sqlc.narg(hub_email)::text IS NULL
            OR h.email_address = sqlc.narg(hub_email))
), org_targets AS (
    SELECT d.org_did
    FROM vetchium.org_domains AS d
    WHERE d.domain = sqlc.narg(org_domain)::text
), user_targets AS (
    SELECT u.org_user_id, u.org_did
    FROM vetchium.org_users AS u
    WHERE u.email_address = sqlc.narg(org_user_email)::text
      AND (sqlc.narg(org_domain)::text IS NULL
            OR u.org_did IN (SELECT org_did FROM org_targets))
)
SELECT
    a.audit_event_id, a.created_at, a.action, a.entity_type,
    a.actor_type, a.source, a.payload,
    COALESCE(h.display_name, '')::text AS actor_name
FROM vetchium.audit_events AS a
LEFT JOIN vetchium.hub_users AS h
    ON a.actor_type = 'hub_user' AND a.actor_id = h.hub_user_did::text
LEFT JOIN vetchium.org_users AS actor
    ON a.actor_type = 'org_user' AND a.actor_id = actor.org_user_id::text
LEFT JOIN vetchium.org_users AS subject
    ON a.entity_type = 'org_user' AND a.entity_id = subject.org_user_id::text
WHERE a.tenant_id = sqlc.arg(tenant_id)
  AND a.entity_type NOT IN (
      'hub_email', 'org.email', 'housekeeping_batch'
  )
  AND (a.action LIKE 'hub.%' OR a.action LIKE 'org.%'
        OR a.action LIKE 'org_user.%')
  AND a.created_at >= sqlc.arg(start_at)::timestamptz
  AND a.created_at <= sqlc.arg(end_at)::timestamptz
  AND (sqlc.narg(before_created_at)::timestamptz IS NULL
        OR (a.created_at, a.audit_event_id)
            < (sqlc.narg(before_created_at), sqlc.narg(before_event_id)::uuid))
  AND ((sqlc.narg(hub_handle)::text IS NULL
            AND sqlc.narg(hub_email)::text IS NULL)
        OR EXISTS (
            SELECT 1 FROM hub_targets AS ht
            WHERE a.subject_hub_user_did = ht.hub_user_did
              OR (a.actor_type = 'hub_user' AND a.actor_id = ht.hub_user_did::text)
              OR (a.entity_type IN ('hub_user', 'hub_subscription')
                    AND a.entity_id = ht.hub_user_did::text)
        ))
  AND (sqlc.narg(org_domain)::text IS NULL OR EXISTS (
        SELECT 1 FROM org_targets AS ot
        WHERE a.subject_org_did = ot.org_did
          OR actor.org_did = ot.org_did OR subject.org_did = ot.org_did
          OR EXISTS (SELECT 1 FROM vetchium.org_users AS affected
              WHERE affected.org_did = ot.org_did
                AND affected.org_user_id = ANY(a.subject_org_user_ids))
          OR (a.entity_type IN ('org', 'org_domain')
                AND a.entity_id = ot.org_did::text)
          OR (a.entity_type = 'org_domain'
                AND a.entity_id = sqlc.narg(org_domain)::text)
    ))
  AND (sqlc.narg(org_user_email)::text IS NULL OR EXISTS (
        SELECT 1 FROM user_targets AS ut
        WHERE ut.org_user_id = ANY(a.subject_org_user_ids)
          OR (a.actor_type = 'org_user' AND a.actor_id = ut.org_user_id::text)
          OR (a.entity_type = 'org_user' AND a.entity_id = ut.org_user_id::text)
    ))
ORDER BY a.created_at DESC, a.audit_event_id DESC
LIMIT sqlc.arg(page_limit);
