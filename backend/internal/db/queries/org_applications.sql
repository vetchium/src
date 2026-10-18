-- Taken first by hub-apply: the Opening row lock serializes numbering and
-- the duplicate check for the Opening. The next statement then sees every
-- committed application.
-- name: LockOrgOpeningForApplication :one
SELECT o.org_opening_id, o.opening_state, org.org_state,
    o.next_application_number
FROM vetchium.org_openings AS o
JOIN vetchium.orgs AS org ON org.org_did = o.org_did
WHERE o.org_did = sqlc.arg(org_did)
  AND o.opening_number = sqlc.arg(opening_number)::integer
FOR UPDATE OF o;

-- The no-op update makes a concurrent first application of the same person to
-- two Openings both return the one row.
-- name: EnsureOrgApplicant :one
INSERT INTO vetchium.org_applicants (
    org_applicant_id, org_did, applicant_kind, hub_user_did
)
VALUES (
    sqlc.arg(applicant_id), sqlc.arg(org_did), 'hub_user',
    sqlc.arg(hub_user_did)
)
ON CONFLICT (org_did, hub_user_did) DO UPDATE
SET hub_user_did = EXCLUDED.hub_user_did
RETURNING org_applicant_id;

-- The caller holds the Opening row lock and passes its counter, so the
-- number is never reused. A second application by the same applicant inserts
-- nothing and changes nothing.
-- name: CreateOrgApplication :one
WITH created AS (
    INSERT INTO vetchium.org_applications (
        org_application_id, org_opening_id, application_number,
        org_applicant_id, snapshot, cover_note
    )
    VALUES (
        sqlc.arg(application_id), sqlc.arg(org_opening_id),
        sqlc.arg(application_number)::integer, sqlc.arg(applicant_id),
        sqlc.arg(snapshot)::jsonb, sqlc.narg(cover_note)::text
    )
    ON CONFLICT (org_opening_id, org_applicant_id) DO NOTHING
    RETURNING org_application_id, application_number, application_state,
        version
), counter AS (
    UPDATE vetchium.org_openings AS o
    SET next_application_number = o.next_application_number + 1
    FROM created
    WHERE o.org_opening_id = sqlc.arg(org_opening_id)
      AND o.next_application_number = created.application_number
    RETURNING o.org_opening_id
), history AS (
    INSERT INTO vetchium.org_application_history (
        org_application_history_id, org_application_id, action, actor_kind,
        application_state, application_version
    )
    SELECT sqlc.arg(history_id), created.org_application_id, 'applied',
        'applicant', created.application_state, created.version
    FROM created
    RETURNING org_application_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.application.applied',
        'org_application',
        sqlc.arg(org_did)::uuid::text || ':' ||
            sqlc.arg(opening_number)::integer::text || ':' ||
            created.application_number::text,
        'hub_user', sqlc.arg(hub_user_did)::text, sqlc.arg(org_did),
        'federation-command', sqlc.arg(command_id)::text,
        jsonb_build_object('opening_number', sqlc.arg(opening_number)::integer,
            'application_number', created.application_number,
            'action', 'applied', 'version', created.version,
            'source_tenant_id', sqlc.arg(source_tenant_id)::text,
            'has_cover_note', sqlc.narg(cover_note)::text IS NOT NULL)
    FROM created
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM created) AS created_rows,
    (SELECT count(*) FROM counter) AS counter_rows,
    (SELECT count(*) FROM history) AS history_rows,
    (SELECT count(*) FROM audit) AS audit_rows,
    COALESCE((SELECT application_number FROM created), 0)::integer
        AS application_number;

-- The opening row leads, so a caller who may not read the Opening's
-- applications gets no row at all, while one who may and finds nothing gets a
-- single row with a null application number.
-- name: ListOrgApplications :many
SELECT a.application_number, a.application_state, a.version,
    COALESCE(a.snapshot ->> 'display_name', '')::text AS display_name,
    COALESCE(a.snapshot ->> 'resident_country', '')::text AS resident_country,
    stage.org_opening_stage_id AS stage_id, stage.name AS stage_name,
    stage.stage_kind, a.created_at, a.updated_at
FROM vetchium.org_openings AS o
LEFT JOIN vetchium.org_applications AS a
    ON a.org_opening_id = o.org_opening_id
    AND a.application_state::text = ANY(sqlc.arg(states)::text[])
    AND (sqlc.narg(stage_id)::uuid IS NULL
        OR a.current_stage_id = sqlc.narg(stage_id)::uuid)
    AND (sqlc.narg(name_query)::text IS NULL
        OR strpos(lower(a.snapshot ->> 'display_name'),
            lower(sqlc.narg(name_query)::text)) > 0)
    AND (sqlc.narg(after_application_number)::integer IS NULL
        OR a.application_number < sqlc.narg(after_application_number)::integer)
LEFT JOIN vetchium.org_opening_stages AS stage
    ON stage.org_opening_stage_id = a.current_stage_id
WHERE o.org_did = sqlc.arg(org_did)
  AND o.opening_number = sqlc.arg(opening_number)::integer
  AND vetchium.org_user_reads_applications(o.org_opening_id, sqlc.arg(viewer_id))
ORDER BY a.application_number DESC NULLS LAST
LIMIT sqlc.arg(page_limit);

-- name: GetOrgApplication :one
SELECT a.application_number, a.application_state, a.version, a.snapshot,
    a.cover_note, stage.org_opening_stage_id AS stage_id,
    stage.name AS stage_name, stage.stage_kind, a.created_at, a.updated_at,
    COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'stage', jsonb_build_object('id', s.org_opening_stage_id,
                'name', s.name, 'kind', s.stage_kind),
            'status', r.stage_status
        ) ORDER BY s.position)
        FROM vetchium.org_application_stages AS r
        JOIN vetchium.org_opening_stages AS s
            ON s.org_opening_stage_id = r.org_opening_stage_id
        WHERE r.org_application_id = a.org_application_id
    ), '[]'::jsonb)::jsonb AS stage_records
FROM vetchium.org_openings AS o
JOIN vetchium.org_applications AS a ON a.org_opening_id = o.org_opening_id
LEFT JOIN vetchium.org_opening_stages AS stage
    ON stage.org_opening_stage_id = a.current_stage_id
WHERE o.org_did = sqlc.arg(org_did)
  AND o.opening_number = sqlc.arg(opening_number)::integer
  AND a.application_number = sqlc.arg(application_number)::integer
  AND vetchium.org_user_reads_applications(o.org_opening_id, sqlc.arg(viewer_id));

-- name: GetOrgApplicationCounts :one
SELECT o.opening_number,
    (
        SELECT jsonb_agg(jsonb_build_object(
            'state', s.state, 'count', COALESCE(c.applications, 0)
        ) ORDER BY s.position)
        FROM unnest(enum_range(NULL::vetchium.org_application_state))
            WITH ORDINALITY AS s(state, position)
        LEFT JOIN (
            SELECT a.application_state, count(*) AS applications
            FROM vetchium.org_applications AS a
            WHERE a.org_opening_id = o.org_opening_id
            GROUP BY a.application_state
        ) AS c ON c.application_state = s.state
    )::jsonb AS states,
    COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'stage', jsonb_build_object('id', st.org_opening_stage_id,
                'name', st.name, 'kind', st.stage_kind),
            'count', (
                SELECT count(*) FROM vetchium.org_applications AS a
                WHERE a.current_stage_id = st.org_opening_stage_id
                  AND a.application_state IN
                      ('in_pipeline', 'offered', 'offer_accepted')
            )
        ) ORDER BY st.position)
        FROM vetchium.org_opening_stages AS st
        WHERE st.org_opening_id = o.org_opening_id
    ), '[]'::jsonb)::jsonb AS stages
FROM vetchium.org_openings AS o
WHERE o.org_did = sqlc.arg(org_did)
  AND o.opening_number = sqlc.arg(opening_number)::integer
  AND vetchium.org_user_reads_applications(o.org_opening_id, sqlc.arg(viewer_id));

-- Like ListOrgApplications, the application leads so an unreadable one
-- yields no row.
-- name: ListOrgApplicationHistory :many
SELECT h.org_application_history_id, h.action, h.actor_kind,
    actor.email_address AS actor_email, h.application_state,
    h.application_version, h.created_at
FROM vetchium.org_openings AS o
JOIN vetchium.org_applications AS a ON a.org_opening_id = o.org_opening_id
LEFT JOIN vetchium.org_application_history AS h
    ON h.org_application_id = a.org_application_id
    AND (sqlc.narg(after_created_at)::timestamptz IS NULL
        OR (h.created_at, h.org_application_history_id) <
            (sqlc.narg(after_created_at)::timestamptz,
             sqlc.narg(after_history_id)::uuid))
LEFT JOIN vetchium.org_users AS actor
    ON actor.org_user_id = h.actor_org_user_id
WHERE o.org_did = sqlc.arg(org_did)
  AND o.opening_number = sqlc.arg(opening_number)::integer
  AND a.application_number = sqlc.arg(application_number)::integer
  AND vetchium.org_user_reads_applications(o.org_opening_id, sqlc.arg(viewer_id))
ORDER BY h.created_at DESC NULLS LAST, h.org_application_history_id DESC NULLS LAST
LIMIT sqlc.arg(page_limit);
