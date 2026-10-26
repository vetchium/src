-- The provider's active `sourcing` engagement a Job owner names, from the
-- projection this tenant keeps (MKT-OWN-002).
-- name: GetActiveSourcingEngagement :one
SELECT p.engagement_id
FROM vetchium.org_engagement_projections AS p
WHERE p.engagement_id = sqlc.arg(engagement_id)
  AND p.provider_org_did = sqlc.arg(org_did)
  AND p.capability_oid = 'sourcing'
  AND p.engagement_state = 'active';

-- Serializes the owner count of one user, so the cap read in the next
-- statement cannot race a sibling assignment (MKT-OWN-003).
-- name: LockOrgUserByEmail :one
SELECT u.org_user_id
FROM vetchium.org_users AS u
WHERE u.org_did = sqlc.arg(org_did) AND u.email_address = sqlc.arg(email_address)
FOR UPDATE;

-- Whether a locked user may own Jobs, and how many Jobs of active engagements
-- they own besides this one.
-- name: GetJobOwnerCandidate :one
SELECT (u.org_user_state = 'active' AND EXISTS (
        SELECT 1
        FROM vetchium.org_effective_permissions AS ep
        WHERE ep.org_user_id = u.org_user_id
          AND ep.permission = 'org:fulfil_engagements'
    ))::boolean AS eligible,
    (
        SELECT count(*)
        FROM vetchium.org_job_owners AS j
        JOIN vetchium.org_engagement_projections AS p
            ON p.engagement_id = j.engagement_id
        WHERE j.owner_org_user_id = u.org_user_id
          AND p.engagement_state = 'active'
          AND (j.engagement_id, j.opening_number) <>
              (sqlc.arg(engagement_id)::uuid, sqlc.arg(opening_number)::integer)
    )::integer AS owned
FROM vetchium.org_users AS u
WHERE u.org_user_id = sqlc.arg(org_user_id);

-- Sets or clears a Job's owner when the caller read expected_version: 0
-- inserts the first row, anything else updates that version. No row back
-- means the version moved. The two writes never act together, because
-- expected_version picks exactly one.
-- name: SetOrgJobOwner :one
WITH previous AS (
    SELECT j.owner_org_user_id
    FROM vetchium.org_job_owners AS j
    WHERE j.engagement_id = sqlc.arg(engagement_id)
      AND j.opening_number = sqlc.arg(opening_number)::integer
), inserted AS (
    INSERT INTO vetchium.org_job_owners AS j (
        engagement_id, opening_number, org_did, owner_org_user_id, version
    )
    SELECT sqlc.arg(engagement_id), sqlc.arg(opening_number)::integer,
        sqlc.arg(org_did), sqlc.narg(owner_org_user_id)::uuid, 1
    WHERE sqlc.arg(expected_version)::integer = 0
    ON CONFLICT (engagement_id, opening_number) DO NOTHING
    RETURNING j.version, j.owner_org_user_id
), updated AS (
    UPDATE vetchium.org_job_owners AS j
    SET owner_org_user_id = sqlc.narg(owner_org_user_id)::uuid,
        version = j.version + 1, updated_at = now()
    WHERE j.engagement_id = sqlc.arg(engagement_id)
      AND j.opening_number = sqlc.arg(opening_number)::integer
      AND j.org_did = sqlc.arg(org_did)
      AND sqlc.arg(expected_version)::integer > 0
      AND j.version = sqlc.arg(expected_version)::integer
    RETURNING j.version, j.owner_org_user_id
), written AS (
    SELECT version, owner_org_user_id FROM inserted
    UNION ALL
    SELECT version, owner_org_user_id FROM updated
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, subject_org_user_ids, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id),
        CASE WHEN written.owner_org_user_id IS NULL
            THEN 'org.job.owner_cleared' ELSE 'org.job.owner_set' END,
        'org_job',
        sqlc.arg(engagement_id)::uuid::text || '/' ||
            sqlc.arg(opening_number)::integer::text,
        'org_user', sqlc.arg(actor_id)::uuid::text, sqlc.arg(org_did),
        ARRAY(
            SELECT DISTINCT owner.id
            FROM (
                SELECT written.owner_org_user_id
                UNION ALL
                SELECT previous.owner_org_user_id FROM previous
            ) AS owner(id)
            WHERE owner.id IS NOT NULL
        ),
        'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object(
            'engagement_id', sqlc.arg(engagement_id)::uuid::text,
            'opening_number', sqlc.arg(opening_number)::integer,
            'version', written.version,
            'owner_org_user_id', written.owner_org_user_id::text,
            'previous_owner_org_user_id',
                (SELECT previous.owner_org_user_id::text FROM previous))
    FROM written
    RETURNING audit_event_id
)
SELECT written.version, (SELECT count(*) FROM audit) AS audit_rows
FROM written;

-- The Jobs of active `sourcing` engagements an agency user owns, which the
-- owner filter sends to client tenants. The cap (MKT-OWN-003) bounds them;
-- row_limit only guards that bound.
-- name: ListOwnedJobs :many
SELECT j.engagement_id, j.opening_number
FROM vetchium.org_job_owners AS j
JOIN vetchium.org_users AS u ON u.org_user_id = j.owner_org_user_id
JOIN vetchium.org_engagement_projections AS p
    ON p.engagement_id = j.engagement_id
WHERE j.org_did = sqlc.arg(org_did)
  AND u.org_did = sqlc.arg(org_did)
  AND u.email_address = sqlc.arg(email_address)
  AND p.capability_oid = 'sourcing'
  AND p.engagement_state = 'active'
ORDER BY j.engagement_id, j.opening_number
LIMIT sqlc.arg(row_limit);

-- The owner rows of the listed Jobs, named "<engagement id>/<opening
-- number>", so a page read from client tenants shows who looks after each. A
-- cleared owner answers an empty address.
-- name: ListJobOwners :many
SELECT j.engagement_id, j.opening_number, j.version,
    COALESCE(u.email_address, '')::text AS owner_email
FROM vetchium.org_job_owners AS j
LEFT JOIN vetchium.org_users AS u ON u.org_user_id = j.owner_org_user_id
WHERE j.org_did = sqlc.arg(org_did)
  AND j.engagement_id::text || '/' || j.opening_number::text
      = ANY (sqlc.arg(jobs)::text[]);

-- Agency users who may own a Job, for an autocomplete. Addresses are stored
-- lowercase, so strpos needs no pattern escaping.
-- name: SuggestJobOwners :many
SELECT u.email_address
FROM vetchium.org_users AS u
WHERE u.org_did = sqlc.arg(org_did)
  AND u.org_user_state = 'active'
  AND EXISTS (
      SELECT 1
      FROM vetchium.org_effective_permissions AS ep
      WHERE ep.org_user_id = u.org_user_id
        AND ep.permission = 'org:fulfil_engagements'
  )
  AND (sqlc.narg(query)::text IS NULL
      OR strpos(u.email_address, lower(sqlc.narg(query)::text)) > 0)
ORDER BY u.email_address
LIMIT sqlc.arg(row_limit);

-- The consumers of the provider's active engagements, for an autocomplete.
-- A client with several engagements appears once, under the display name of
-- its latest projection.
-- name: SuggestProviderClients :many
SELECT c.consumer_domain, c.consumer_display_name
FROM (
    SELECT DISTINCT ON (p.consumer_domain)
        p.consumer_domain, p.consumer_display_name
    FROM vetchium.org_engagement_projections AS p
    WHERE p.provider_org_did = sqlc.arg(org_did)
      AND p.engagement_state = 'active'
      AND (sqlc.narg(capability)::text IS NULL
          OR p.capability_oid = sqlc.narg(capability)::text)
      AND (sqlc.narg(query)::text IS NULL
          OR strpos(lower(p.consumer_display_name),
              lower(sqlc.narg(query)::text)) > 0
          OR strpos(p.consumer_domain, lower(sqlc.narg(query)::text)) > 0)
    ORDER BY p.consumer_domain, p.updated_at DESC
) AS c
ORDER BY lower(c.consumer_display_name), c.consumer_domain
LIMIT sqlc.arg(row_limit);
