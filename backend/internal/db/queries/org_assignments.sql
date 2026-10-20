-- Serializes assignments to one Opening, so the cap check in the inserting
-- statement cannot race a sibling request. Any Opening state is locked; the
-- handler judges the state.
-- name: LockOrgOpeningForProviders :one
SELECT o.org_opening_id, o.opening_state::text AS opening_state
FROM vetchium.org_openings AS o
WHERE o.org_did = sqlc.arg(org_did)
  AND o.opening_number = sqlc.arg(opening_number)::integer
FOR UPDATE;

-- The same Opening without the lock, for a read.
-- name: GetOrgOpeningForProviders :one
SELECT o.org_opening_id, o.opening_state::text AS opening_state
FROM vetchium.org_openings AS o
WHERE o.org_did = sqlc.arg(org_did)
  AND o.opening_number = sqlc.arg(opening_number)::integer;

-- name: ListOpeningStages :many
SELECT s.org_opening_stage_id, s.name, s.stage_kind
FROM vetchium.org_opening_stages AS s
WHERE s.org_opening_id = sqlc.arg(org_opening_id)
ORDER BY s.position;

-- name: ListOpeningAssignments :many
SELECT a.org_opening_stage_id, a.engagement_id, e.provider_domain,
    e.provider_display_name, e.capability_oid, a.assigned_at
FROM vetchium.org_engagement_assignments AS a
JOIN vetchium.org_engagements AS e ON e.engagement_id = a.engagement_id
WHERE a.org_opening_id = sqlc.arg(org_opening_id)
ORDER BY a.assigned_at, a.assignment_id;

-- What the assignment checks need of the caller's own engagement: its state,
-- Capability, and the stage kind that Capability performs.
-- name: GetEngagementForAssignment :one
SELECT e.engagement_state, e.capability_oid,
    COALESCE(c.performs_stage_kind::text, '')::text AS performs_stage_kind
FROM vetchium.org_engagements AS e
JOIN vetchium.capabilities AS c ON c.capability_oid = e.capability_oid
WHERE e.engagement_id = sqlc.arg(engagement_id)
  AND e.consumer_org_did = sqlc.arg(org_did);

-- The stage of the Opening, to check the Capability performs its kind.
-- name: GetOpeningStageKind :one
SELECT s.stage_kind::text AS stage_kind
FROM vetchium.org_opening_stages AS s
WHERE s.org_opening_stage_id = sqlc.arg(stage_id)
  AND s.org_opening_id = sqlc.arg(org_opening_id);

-- An existing assignment is reported through already_assigned, and a full
-- Opening or stage through used; the caller holds the Opening lock.
-- name: AssignOrgEngagement :one
WITH used AS (
    SELECT count(*)::integer AS used
    FROM vetchium.org_engagement_assignments AS a
    WHERE a.org_opening_id = sqlc.arg(org_opening_id)
      AND a.org_opening_stage_id IS NOT DISTINCT FROM sqlc.narg(stage_id)::uuid
), present AS (
    SELECT EXISTS (
        SELECT 1 FROM vetchium.org_engagement_assignments AS a
        WHERE a.engagement_id = sqlc.arg(engagement_id)
          AND a.org_opening_id = sqlc.arg(org_opening_id)
          AND a.org_opening_stage_id IS NOT DISTINCT FROM sqlc.narg(stage_id)::uuid
    ) AS already_assigned
), assigned AS (
    INSERT INTO vetchium.org_engagement_assignments (
        assignment_id, engagement_id, org_opening_id, org_opening_stage_id,
        assigned_by
    )
    SELECT sqlc.arg(assignment_id), sqlc.arg(engagement_id),
        sqlc.arg(org_opening_id), sqlc.narg(stage_id)::uuid,
        sqlc.arg(actor_id)::uuid
    FROM used CROSS JOIN present
    WHERE used.used < sqlc.arg(assignment_limit)::integer
      AND NOT present.already_assigned
    RETURNING assignment_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.engagement.assigned', 'org_engagement',
        sqlc.arg(engagement_id)::uuid::text, 'org_user',
        sqlc.arg(actor_id)::uuid::text, sqlc.arg(org_did), 'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('action', 'assigned',
            'opening_number', sqlc.arg(opening_number)::integer,
            'stage_id', sqlc.narg(stage_id)::uuid::text)
    FROM assigned
    RETURNING audit_event_id
)
SELECT used.used, present.already_assigned,
    (SELECT count(*) FROM assigned) AS assigned_rows,
    (SELECT count(*) FROM audit) AS audit_rows
FROM used CROSS JOIN present;

-- Removing an assignment ends every route through it by cascade; recorded
-- work references the engagement, not the route, and stays.
-- name: UnassignOrgEngagement :one
WITH removed AS (
    DELETE FROM vetchium.org_engagement_assignments AS a
    WHERE a.org_opening_id = sqlc.arg(org_opening_id)
      AND a.engagement_id = sqlc.arg(engagement_id)
      AND a.org_opening_stage_id IS NOT DISTINCT FROM sqlc.narg(stage_id)::uuid
    RETURNING a.assignment_id
), ended AS (
    SELECT count(*)::integer AS routes
    FROM vetchium.org_application_routes AS r
    WHERE r.assignment_id IN (SELECT assignment_id FROM removed)
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.engagement.unassigned', 'org_engagement',
        sqlc.arg(engagement_id)::uuid::text, 'org_user',
        sqlc.arg(actor_id)::uuid::text, sqlc.arg(org_did), 'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('action', 'unassigned',
            'opening_number', sqlc.arg(opening_number)::integer,
            'stage_id', sqlc.narg(stage_id)::uuid::text,
            'ended_routes', (SELECT routes FROM ended))
    FROM removed
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM removed) AS removed_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- Ending an engagement removes its assignments in the ending transaction,
-- and so every route through them (MKT-ENG-004). The caller's audit event
-- for the ending covers the deletion.
-- name: DeleteOrgEngagementAssignments :exec
DELETE FROM vetchium.org_engagement_assignments
WHERE engagement_id = sqlc.arg(engagement_id);

-- The assignment of the engagement to the candidacy's current stage, if any,
-- with the Capability the engagement performs.
-- name: GetStageAssignment :one
SELECT a.assignment_id, e.capability_oid, e.engagement_state
FROM vetchium.org_engagement_assignments AS a
JOIN vetchium.org_engagements AS e ON e.engagement_id = a.engagement_id
WHERE a.org_opening_stage_id = sqlc.arg(stage_id)
  AND a.engagement_id = sqlc.arg(engagement_id)
  AND e.consumer_org_did = sqlc.arg(org_did);

-- The assignment a candidacy is routed through, if it is routed.
-- name: GetApplicationRouteAssignment :one
SELECT r.assignment_id
FROM vetchium.org_application_routes AS r
WHERE r.org_application_id = sqlc.arg(application_id);

-- Routes the candidacy through an assignment, replacing any route, in one
-- statement that also advances the version (the caller holds the application
-- lock). Rerouting ends the previous provider's access by replacing the row.
-- name: RouteOrgApplication :one
WITH changed AS (
    UPDATE vetchium.org_applications AS a
    SET version = a.version + 1, updated_at = now()
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state = 'in_pipeline'
    RETURNING a.org_application_id
), placed AS (
    INSERT INTO vetchium.org_application_routes (
        org_application_id, route_id, assignment_id, consent_disclosure,
        listing_check_types, routed_by
    )
    SELECT changed.org_application_id, gen_random_uuid(), sqlc.arg(assignment_id),
        sqlc.narg(consent_disclosure), COALESCE(sqlc.arg(listing_check_types)::text[], '{}'),
        sqlc.arg(actor_id)::uuid
    FROM changed
    ON CONFLICT (org_application_id) DO UPDATE
    SET route_id = EXCLUDED.route_id, assignment_id = EXCLUDED.assignment_id,
        consent_disclosure = EXCLUDED.consent_disclosure,
        listing_check_types = EXCLUDED.listing_check_types,
        routed_by = EXCLUDED.routed_by, routed_at = now()
    RETURNING org_application_id
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM placed) AS placed_rows;

-- Routes the candidacy back in-house.
-- name: ClearOrgApplicationRoute :one
WITH changed AS (
    UPDATE vetchium.org_applications AS a
    SET version = a.version + 1, updated_at = now()
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state = 'in_pipeline'
    RETURNING a.org_application_id
), removed AS (
    DELETE FROM vetchium.org_application_routes AS r
    USING changed
    WHERE r.org_application_id = changed.org_application_id
    RETURNING r.org_application_id
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM removed) AS removed_rows;
