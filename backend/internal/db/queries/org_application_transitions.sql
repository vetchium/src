-- The Org's writes on an application (agent-guides/hiring-pipeline.md,
-- States). Each write takes the application's row lock first, decides in Go
-- from what that read returns, then runs one guarded statement; the guards
-- repeat the state and version so a decision never outlives its read. The
-- history and audit rows come from RecordOrgApplicationChanges in the same
-- transaction.

-- The application row leads the lock, and the read predicate (which admits an
-- interviewer to the applications of their interviews only) keeps an
-- unreadable application indistinguishable from an unknown number. A null
-- target_position means the stage is not part of the Opening's pipeline.
-- name: LockOrgApplicationForWrite :one
SELECT a.org_application_id, o.org_opening_id, o.org_did, o.opening_number,
    COALESCE(c.title, '')::text AS opening_title,
    a.application_number,
    COALESCE(a.snapshot->>'display_name', '')::text AS applicant_display_name,
    a.credited_engagement_id, a.application_state, a.version,
    vetchium.org_user_acts_on_applications(o.org_opening_id,
        sqlc.arg(viewer_id)) AS can_act,
    a.current_stage_id, current_stage.position AS current_position,
    current_stage.stage_kind AS current_stage_kind,
    COALESCE((
        SELECT r.stage_status::text
        FROM vetchium.org_application_stages AS r
        WHERE r.org_application_id = a.org_application_id
          AND r.org_opening_stage_id = a.current_stage_id
    ), '')::text AS current_stage_status,
    target.position AS target_position,
    a.joined_on, a.joined_recorded_at, a.separated_on,
    a.separated_recorded_at, a.offer_extended_at,
    (rt.org_application_id IS NOT NULL)::boolean AS routed,
    route_asg.engagement_id AS route_engagement_id,
    rt.consent_disclosure AS route_disclosure,
    COALESCE(rt.listing_check_types, '{}')::text[] AS route_check_types
FROM vetchium.org_openings AS o
JOIN vetchium.org_applications AS a ON a.org_opening_id = o.org_opening_id
LEFT JOIN vetchium.org_opening_contents AS c
    ON c.org_opening_id = o.org_opening_id AND c.slot = 'live'
LEFT JOIN vetchium.org_application_routes AS rt
    ON rt.org_application_id = a.org_application_id
LEFT JOIN vetchium.org_engagement_assignments AS route_asg
    ON route_asg.assignment_id = rt.assignment_id
LEFT JOIN vetchium.org_opening_stages AS current_stage
    ON current_stage.org_opening_stage_id = a.current_stage_id
LEFT JOIN vetchium.org_opening_stages AS target
    ON target.org_opening_stage_id = sqlc.narg(target_stage_id)::uuid
    AND target.org_opening_id = o.org_opening_id
WHERE o.org_did = sqlc.arg(org_did)
  AND o.opening_number = sqlc.arg(opening_number)::integer
  AND a.application_number = sqlc.arg(application_number)::integer
  AND vetchium.org_user_reads_applications(o.org_opening_id,
      sqlc.arg(viewer_id), a.org_application_id)
FOR UPDATE OF a;

-- Shortlisting records every stage of the pipeline: the ones before the
-- chosen stage are passed over.
-- name: ShortlistOrgApplication :one
WITH target AS (
    SELECT s.org_opening_stage_id, s.position
    FROM vetchium.org_opening_stages AS s
    JOIN vetchium.org_applications AS a
        ON a.org_opening_id = s.org_opening_id
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND s.org_opening_stage_id = sqlc.arg(stage_id)
), changed AS (
    UPDATE vetchium.org_applications AS a
    SET application_state = 'in_pipeline',
        current_stage_id = target.org_opening_stage_id,
        version = a.version + 1, updated_at = now()
    FROM target
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state = 'submitted'
    RETURNING a.org_application_id, a.org_opening_id
), records AS (
    INSERT INTO vetchium.org_application_stages (
        org_application_id, org_opening_stage_id, stage_status
    )
    SELECT changed.org_application_id, s.org_opening_stage_id,
        CASE WHEN s.position < target.position
            THEN 'skipped'::vetchium.org_application_stage_status
            ELSE 'pending'::vetchium.org_application_stage_status END
    FROM changed
    JOIN vetchium.org_opening_stages AS s
        ON s.org_opening_id = changed.org_opening_id
    CROSS JOIN target
    RETURNING org_application_id
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM records) AS record_rows;

-- Moving forward skips every unfinished stage before the target, the stage
-- left included, and ends a consent request still awaiting an answer there.
-- A stage added to the pipeline after the shortlist gets its
-- record here. The skipped rows exist already and the added ones do not, so
-- the two statements never write one key.
-- name: MoveOrgApplicationStage :one
WITH target AS (
    SELECT s.org_opening_stage_id, s.position
    FROM vetchium.org_opening_stages AS s
    JOIN vetchium.org_applications AS a
        ON a.org_opening_id = s.org_opening_id
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND s.org_opening_stage_id = sqlc.arg(stage_id)
), changed AS (
    UPDATE vetchium.org_applications AS a
    SET current_stage_id = target.org_opening_stage_id,
        version = a.version + 1, updated_at = now()
    FROM target, vetchium.org_opening_stages AS current_stage
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state = 'in_pipeline'
      AND current_stage.org_opening_stage_id = a.current_stage_id
      AND target.position > current_stage.position
    RETURNING a.org_application_id, a.org_opening_id
), skipped AS (
    UPDATE vetchium.org_application_stages AS r
    SET stage_status = 'skipped'
    FROM changed, target, vetchium.org_opening_stages AS s
    WHERE r.org_application_id = changed.org_application_id
      AND r.stage_status = 'pending'
      AND s.org_opening_stage_id = r.org_opening_stage_id
      AND s.position < target.position
    RETURNING r.org_application_id
), added AS (
    INSERT INTO vetchium.org_application_stages (
        org_application_id, org_opening_stage_id, stage_status
    )
    SELECT changed.org_application_id, s.org_opening_stage_id,
        CASE WHEN s.position < target.position
            THEN 'skipped'::vetchium.org_application_stage_status
            ELSE 'pending'::vetchium.org_application_stage_status END
    FROM changed
    JOIN vetchium.org_opening_stages AS s
        ON s.org_opening_id = changed.org_opening_id
    CROSS JOIN target
    WHERE NOT EXISTS (
        SELECT 1 FROM vetchium.org_application_stages AS r
        WHERE r.org_application_id = changed.org_application_id
          AND r.org_opening_stage_id = s.org_opening_stage_id
    )
    ON CONFLICT DO NOTHING
    RETURNING org_application_id
), consents AS (
    SELECT vetchium.end_pending_consents(
        ARRAY(SELECT org_application_id FROM changed)) AS ended,
        vetchium.end_provider_access(
        ARRAY(SELECT org_application_id FROM changed)) AS ended_access
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    COALESCE((SELECT ended FROM consents), 0)::integer AS ended_consents;

-- name: CompleteOrgApplicationStage :one
WITH changed AS (
    UPDATE vetchium.org_applications AS a
    SET version = a.version + 1, updated_at = now()
    FROM vetchium.org_opening_stages AS s
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state = 'in_pipeline'
      AND s.org_opening_stage_id = a.current_stage_id
      AND s.stage_kind = 'review'
      AND EXISTS (
          SELECT 1 FROM vetchium.org_application_stages AS r
          WHERE r.org_application_id = a.org_application_id
            AND r.org_opening_stage_id = a.current_stage_id
            AND r.stage_status = 'pending'
      )
    RETURNING a.org_application_id, a.current_stage_id
), completed AS (
    UPDATE vetchium.org_application_stages AS r
    SET stage_status = 'completed'
    FROM changed
    WHERE r.org_application_id = changed.org_application_id
      AND r.org_opening_stage_id = changed.current_stage_id
      AND r.stage_status = 'pending'
    RETURNING r.org_application_id
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM completed) AS completed_rows;

-- Leaving an offered state withdraws the offer that awaited an answer, and
-- leaving the pipeline cancels the upcoming interviews (HP-STA-002).
-- name: MarkOrgApplicationNotProgressing :one
WITH changed AS (
    UPDATE vetchium.org_applications AS a
    SET application_state = 'not_progressing', version = a.version + 1,
        updated_at = now()
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state IN
          ('submitted', 'in_pipeline', 'offered', 'offer_accepted')
    RETURNING a.org_application_id
), ended AS (
    UPDATE vetchium.org_application_offers AS o
    SET offer_status = 'withdrawn', ended_at = now()
    FROM changed
    WHERE o.org_application_id = changed.org_application_id
      AND o.offer_status = 'extended'
    RETURNING o.org_application_id
), cancelled AS (
    SELECT vetchium.cancel_upcoming_interviews(
        ARRAY(SELECT org_application_id FROM changed)) AS interviews,
        vetchium.end_pending_consents(
        ARRAY(SELECT org_application_id FROM changed)) AS consents,
        vetchium.end_provider_access(
        ARRAY(SELECT org_application_id FROM changed)) AS access
)
SELECT count(*) AS changed_rows,
    COALESCE((SELECT interviews FROM cancelled), 0)::integer
        AS cancelled_interviews
FROM changed;

-- Both end the candidacy, so they cancel its upcoming interviews too.
-- name: RecordOrgApplicationJoined :execrows
WITH changed AS (
    UPDATE vetchium.org_applications AS a
    SET application_state = 'joined', joined_on = sqlc.arg(joined_on)::date,
        joined_recorded_at = now(), version = a.version + 1, updated_at = now()
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state = 'offer_accepted'
    RETURNING a.org_application_id
), cancelled AS (
    SELECT vetchium.cancel_upcoming_interviews(
        ARRAY(SELECT org_application_id FROM changed)) AS interviews,
        vetchium.end_pending_consents(
        ARRAY(SELECT org_application_id FROM changed)) AS consents,
        vetchium.end_provider_access(
        ARRAY(SELECT org_application_id FROM changed)) AS access
)
SELECT changed.org_application_id
FROM changed
WHERE EXISTS (SELECT 1 FROM cancelled);

-- name: RecordOrgApplicationDidNotJoin :execrows
WITH changed AS (
    UPDATE vetchium.org_applications AS a
    SET application_state = 'did_not_join', version = a.version + 1,
        updated_at = now()
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state = 'offer_accepted'
    RETURNING a.org_application_id
), cancelled AS (
    SELECT vetchium.cancel_upcoming_interviews(
        ARRAY(SELECT org_application_id FROM changed)) AS interviews,
        vetchium.end_pending_consents(
        ARRAY(SELECT org_application_id FROM changed)) AS consents,
        vetchium.end_provider_access(
        ARRAY(SELECT org_application_id FROM changed)) AS access
)
SELECT changed.org_application_id
FROM changed
WHERE EXISTS (SELECT 1 FROM cancelled);

-- name: RecordOrgApplicationSeparated :execrows
UPDATE vetchium.org_applications AS a
SET separated_on = sqlc.arg(separated_on)::date, separated_recorded_at = now(),
    version = a.version + 1, updated_at = now()
WHERE a.org_application_id = sqlc.arg(application_id)
  AND a.version = sqlc.arg(version)::integer
  AND a.application_state = 'joined'
  AND a.separated_on IS NULL
  AND sqlc.arg(separated_on)::date > a.joined_on
  AND sqlc.arg(separated_on)::date <= a.joined_on + 365;

-- window_start is the earliest first-recording instant still correctable.
-- name: CorrectOrgApplicationJoinedOn :execrows
UPDATE vetchium.org_applications AS a
SET joined_on = sqlc.arg(joined_on)::date, version = a.version + 1,
    updated_at = now()
WHERE a.org_application_id = sqlc.arg(application_id)
  AND a.version = sqlc.arg(version)::integer
  AND a.application_state = 'joined'
  AND a.joined_recorded_at > sqlc.arg(window_start)::timestamptz
  AND (a.separated_on IS NULL OR (
      a.separated_on > sqlc.arg(joined_on)::date
      AND a.separated_on <= sqlc.arg(joined_on)::date + 365))
  AND (a.offer_extended_at IS NULL
      OR sqlc.arg(joined_on)::date >=
          (a.offer_extended_at AT TIME ZONE 'UTC')::date);

-- name: CorrectOrgApplicationSeparatedOn :execrows
UPDATE vetchium.org_applications AS a
SET separated_on = sqlc.arg(separated_on)::date, version = a.version + 1,
    updated_at = now()
WHERE a.org_application_id = sqlc.arg(application_id)
  AND a.version = sqlc.arg(version)::integer
  AND a.application_state = 'joined'
  AND a.separated_on IS NOT NULL
  AND a.separated_recorded_at > sqlc.arg(window_start)::timestamptz
  AND sqlc.arg(separated_on)::date > a.joined_on
  AND sqlc.arg(separated_on)::date <= a.joined_on + 365;

-- Records the history entry and audit event for each changed application, in
-- the transaction that changed it. Neither holds notes, feedback, or snapshot
-- text. The history time is the wall clock so concurrent writes list in the
-- order they took the application lock.
-- name: RecordOrgApplicationChanges :one
WITH subject AS (
    SELECT a.org_application_id, a.application_state, a.version,
        a.application_number, o.opening_number, o.org_did
    FROM vetchium.org_applications AS a
    JOIN vetchium.org_openings AS o ON o.org_opening_id = a.org_opening_id
    WHERE a.org_application_id = ANY(sqlc.arg(application_ids)::uuid[])
), history AS (
    INSERT INTO vetchium.org_application_history (
        org_application_history_id, org_application_id, action, actor_kind,
        actor_org_user_id, application_state, application_version,
        org_opening_stage_id, joined_on, separated_on, interview_number,
        created_at
    )
    SELECT gen_random_uuid(), subject.org_application_id,
        (sqlc.arg(action)::text)::vetchium.org_application_history_action,
        'org_user', sqlc.arg(actor_id), subject.application_state,
        subject.version, sqlc.narg(stage_id)::uuid,
        sqlc.narg(joined_on)::date, sqlc.narg(separated_on)::date,
        sqlc.narg(interview_number)::integer, clock_timestamp()
    FROM subject
    RETURNING org_application_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.application.' || sqlc.arg(action)::text,
        'org_application',
        subject.org_did::text || ':' || subject.opening_number::text || ':' ||
            subject.application_number::text,
        'org_user', sqlc.arg(actor_id)::text, subject.org_did, 'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_strip_nulls(jsonb_build_object(
            'opening_number', subject.opening_number,
            'application_number', subject.application_number,
            'action', sqlc.arg(action)::text,
            'state', subject.application_state::text,
            'version', subject.version,
            'stage_id', sqlc.narg(stage_id)::uuid,
            'joined_on', sqlc.narg(joined_on)::date,
            'separated_on', sqlc.narg(separated_on)::date,
            'interview_number', sqlc.narg(interview_number)::integer))
    FROM subject
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM subject) AS subject_rows,
    (SELECT count(*) FROM history) AS history_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- The bulk choice of a close request (HP-APP-005). The caller runs it in the
-- transaction that closed the Opening. Only the request that closed it
-- qualifies: it was approved at the closing instant, which every statement of
-- one transaction shares.
-- Offers awaiting an answer are withdrawn with their applications, and
-- upcoming interviews are cancelled (HP-STA-002).
-- name: MarkClosedOpeningApplicationsNotProgressing :many
WITH changed AS (
    UPDATE vetchium.org_applications AS a
    SET application_state = 'not_progressing', version = a.version + 1,
        updated_at = now()
    FROM vetchium.org_openings AS o
    WHERE o.org_opening_id = a.org_opening_id
      AND o.org_did = sqlc.arg(org_did)
      AND o.opening_number = sqlc.arg(opening_number)::integer
      AND o.opening_state = 'closed'
      AND a.application_state IN
          ('submitted', 'in_pipeline', 'offered', 'offer_accepted')
      AND EXISTS (
          SELECT 1 FROM vetchium.org_opening_requests AS r
          WHERE r.org_opening_id = o.org_opening_id
            AND r.request_kind = 'close'
            AND r.request_state = 'approved'
            AND r.mark_applications_not_progressing
            AND r.decided_at = o.ended_at
      )
    RETURNING a.org_application_id
), ended AS (
    UPDATE vetchium.org_application_offers AS f
    SET offer_status = 'withdrawn', ended_at = now()
    FROM changed
    WHERE f.org_application_id = changed.org_application_id
      AND f.offer_status = 'extended'
    RETURNING f.org_application_id
), cancelled AS (
    SELECT vetchium.cancel_upcoming_interviews(
        ARRAY(SELECT org_application_id FROM changed)) AS interviews,
        vetchium.end_pending_consents(
        ARRAY(SELECT org_application_id FROM changed)) AS consents,
        vetchium.end_provider_access(
        ARRAY(SELECT org_application_id FROM changed)) AS access
)
SELECT changed.org_application_id
FROM changed
WHERE EXISTS (SELECT 1 FROM cancelled);
