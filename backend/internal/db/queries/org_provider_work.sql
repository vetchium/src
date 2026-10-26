-- A provider's routed work, as the client's tenant answers it and executes it
-- (agent-guides/marketplace.md, MKT-ACC and MKT-WRK). A provider names work
-- only by its route id, and every statement below finds the candidacy through
-- the route, the assignment, and an active engagement between the two Orgs,
-- so a miss is the same whatever the cause: no route, a rerouted or moved
-- candidacy, an ended engagement, or another provider's work.

-- The routed candidacy with its application row locked. Every provider write
-- starts here and decides from what it returns.
-- name: LockProviderWork :one
SELECT a.org_application_id, o.org_opening_id, o.opening_number,
    COALESCE(c.title, '')::text AS opening_title,
    a.application_number,
    COALESCE(a.snapshot->>'display_name', '')::text AS applicant_display_name,
    a.version, eng.engagement_id, eng.consumer_org_did,
    eng.provider_domain, eng.provider_display_name,
    rt.consent_disclosure, rt.listing_check_types,
    a.current_stage_id, st.stage_kind AS current_stage_kind,
    COALESCE((
        SELECT r.stage_status::text
        FROM vetchium.org_application_stages AS r
        WHERE r.org_application_id = a.org_application_id
          AND r.org_opening_stage_id = a.current_stage_id
    ), '')::text AS current_stage_status
FROM vetchium.org_application_routes AS rt
JOIN vetchium.org_engagement_assignments AS asg
    ON asg.assignment_id = rt.assignment_id
JOIN vetchium.org_engagements AS eng ON eng.engagement_id = asg.engagement_id
JOIN vetchium.org_applications AS a
    ON a.org_application_id = rt.org_application_id
JOIN vetchium.org_openings AS o ON o.org_opening_id = a.org_opening_id
LEFT JOIN vetchium.org_opening_contents AS c
    ON c.org_opening_id = o.org_opening_id AND c.slot = 'live'
JOIN vetchium.org_opening_stages AS st
    ON st.org_opening_stage_id = a.current_stage_id
WHERE rt.route_id = sqlc.arg(work_id)
  AND eng.engagement_id = sqlc.arg(engagement_id)
  AND eng.consumer_org_did = sqlc.arg(org_did)
  AND eng.provider_org_did = sqlc.arg(provider_org_did)
  AND eng.engagement_state = 'active'
  AND o.org_did = eng.consumer_org_did
  AND asg.org_opening_stage_id = a.current_stage_id
  AND a.application_state = 'in_pipeline'
  AND a.removed_at IS NULL
FOR UPDATE OF a;

-- The history and audit rows of a provider's write. The provider appears as
-- the actor by its Org and its user's email address.
-- name: RecordProviderApplicationChange :one
WITH subject AS (
    SELECT a.org_application_id, a.application_state, a.version,
        a.application_number, o.opening_number, o.org_did
    FROM vetchium.org_applications AS a
    JOIN vetchium.org_openings AS o ON o.org_opening_id = a.org_opening_id
    WHERE a.org_application_id = sqlc.arg(application_id)
), history AS (
    INSERT INTO vetchium.org_application_history (
        org_application_history_id, org_application_id, action, actor_kind,
        application_state, application_version, org_opening_stage_id,
        interview_number, created_at
    )
    SELECT gen_random_uuid(), subject.org_application_id,
        (sqlc.arg(action)::text)::vetchium.org_application_history_action,
        'provider', subject.application_state, subject.version,
        sqlc.narg(stage_id)::uuid, sqlc.narg(interview_number)::integer,
        clock_timestamp()
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
        'provider_org', sqlc.arg(provider_org_did)::uuid::text || ':' ||
            sqlc.arg(actor_email)::text,
        subject.org_did, 'federation-command', sqlc.arg(command_id)::text,
        jsonb_strip_nulls(jsonb_build_object(
            'opening_number', subject.opening_number,
            'application_number', subject.application_number,
            'action', sqlc.arg(action)::text,
            'state', subject.application_state::text,
            'version', subject.version,
            'engagement_id', sqlc.arg(engagement_id)::uuid,
            'stage_id', sqlc.narg(stage_id)::uuid,
            'interview_number', sqlc.narg(interview_number)::integer))
    FROM subject
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM subject) AS subject_rows,
    (SELECT count(*) FROM history) AS history_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- The interview of the candidacy that this provider holds, with what the
-- provider's writes need to decide.
-- name: GetProviderInterview :one
SELECT i.org_interview_id, i.interview_state, i.applicant_response,
    (i.starts_at <= now())::boolean AS started,
    EXISTS (
        SELECT 1 FROM vetchium.org_provider_interview_interviewers AS iv
        WHERE iv.org_interview_id = i.org_interview_id
          AND iv.interviewer_email = sqlc.arg(actor_email)::text
    ) AS actor_is_interviewer,
    EXISTS (
        SELECT 1 FROM vetchium.org_provider_interview_feedback AS f
        WHERE f.org_interview_id = i.org_interview_id
          AND f.interviewer_email = sqlc.arg(actor_email)::text
    ) AS actor_submitted_feedback
FROM vetchium.org_interviews AS i
WHERE i.org_application_id = sqlc.arg(application_id)
  AND i.interview_number = sqlc.arg(interview_number)::integer
  AND i.performer_engagement_id = sqlc.arg(engagement_id);

-- name: ScheduleProviderInterview :one
WITH app AS (
    SELECT a.org_application_id,
        (
            SELECT count(*) FROM vetchium.org_interviews AS i
            WHERE i.org_application_id = a.org_application_id
              AND i.org_opening_stage_id = a.current_stage_id
              AND i.interview_state <> 'cancelled'
        )::integer AS stage_interviews
    FROM vetchium.org_applications AS a
    WHERE a.org_application_id = sqlc.arg(application_id)
), changed AS (
    UPDATE vetchium.org_applications AS a
    SET version = a.version + 1, updated_at = now()
    FROM app, vetchium.org_opening_stages AS s
    WHERE a.org_application_id = app.org_application_id
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state = 'in_pipeline'
      AND s.org_opening_stage_id = a.current_stage_id
      AND s.stage_kind = 'interview'
      AND app.stage_interviews < sqlc.arg(max_interviews)::integer
      AND sqlc.arg(starts_at)::timestamptz > now()
    RETURNING a.org_application_id, a.current_stage_id
), created AS (
    INSERT INTO vetchium.org_interviews (
        org_interview_id, org_application_id, interview_number,
        org_opening_stage_id, starts_at, duration_minutes, interview_mode,
        video_url, location, performer_engagement_id
    )
    SELECT sqlc.arg(interview_id), changed.org_application_id,
        COALESCE((
            SELECT max(i.interview_number)
            FROM vetchium.org_interviews AS i
            WHERE i.org_application_id = changed.org_application_id
        ), 0) + 1,
        changed.current_stage_id, sqlc.arg(starts_at)::timestamptz,
        sqlc.arg(duration_minutes)::smallint,
        (sqlc.arg(mode)::text)::vetchium.org_interview_mode,
        sqlc.narg(video_url)::text, sqlc.narg(location)::text,
        sqlc.arg(engagement_id)
    FROM changed
    RETURNING org_interview_id, interview_number
), members AS (
    INSERT INTO vetchium.org_provider_interview_interviewers (
        org_interview_id, interviewer_email
    )
    SELECT created.org_interview_id, wanted.email_address
    FROM created
    CROSS JOIN (
        SELECT DISTINCT email_address
        FROM unnest(sqlc.arg(interviewer_emails)::text[]) AS names(email_address)
    ) AS wanted
    RETURNING interviewer_email
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM created) AS created_rows,
    (SELECT count(*) FROM members) AS member_rows,
    COALESCE((SELECT interview_number FROM created), 0)::integer
        AS interview_number,
    COALESCE((SELECT stage_interviews FROM app), 0)::integer
        AS stage_interviews;

-- name: ChangeProviderInterview :one
WITH target AS (
    SELECT i.org_interview_id, i.org_application_id
    FROM vetchium.org_interviews AS i
    WHERE i.org_application_id = sqlc.arg(application_id)
      AND i.interview_number = sqlc.arg(interview_number)::integer
      AND i.performer_engagement_id = sqlc.arg(engagement_id)
      AND i.interview_state = 'scheduled'
      AND i.starts_at > now()
), wanted AS (
    SELECT DISTINCT email_address
    FROM unnest(sqlc.arg(interviewer_emails)::text[]) AS names(email_address)
), changed AS (
    UPDATE vetchium.org_applications AS a
    SET version = a.version + 1, updated_at = now()
    FROM target
    WHERE a.org_application_id = target.org_application_id
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state = 'in_pipeline'
      AND sqlc.arg(starts_at)::timestamptz > now()
    RETURNING a.org_application_id
), updated AS (
    UPDATE vetchium.org_interviews AS i
    SET starts_at = sqlc.arg(starts_at)::timestamptz,
        duration_minutes = sqlc.arg(duration_minutes)::smallint,
        interview_mode = (sqlc.arg(mode)::text)::vetchium.org_interview_mode,
        video_url = sqlc.narg(video_url)::text,
        location = sqlc.narg(location)::text,
        applicant_response = CASE
            WHEN (i.starts_at, i.duration_minutes, i.interview_mode::text,
                  i.video_url, i.location)
                IS NOT DISTINCT FROM (sqlc.arg(starts_at)::timestamptz,
                  sqlc.arg(duration_minutes)::smallint, sqlc.arg(mode)::text,
                  sqlc.narg(video_url)::text, sqlc.narg(location)::text)
            THEN i.applicant_response
            ELSE 'pending'::vetchium.org_interview_response END,
        reschedule_note = CASE
            WHEN (i.starts_at, i.duration_minutes, i.interview_mode::text,
                  i.video_url, i.location)
                IS NOT DISTINCT FROM (sqlc.arg(starts_at)::timestamptz,
                  sqlc.arg(duration_minutes)::smallint, sqlc.arg(mode)::text,
                  sqlc.narg(video_url)::text, sqlc.narg(location)::text)
            THEN i.reschedule_note ELSE NULL END,
        updated_at = now()
    FROM changed, target
    WHERE i.org_interview_id = target.org_interview_id
      AND i.org_application_id = changed.org_application_id
    RETURNING i.org_interview_id
), removed AS (
    DELETE FROM vetchium.org_provider_interview_interviewers AS iv
    USING updated
    WHERE iv.org_interview_id = updated.org_interview_id
      AND iv.interviewer_email NOT IN (SELECT email_address FROM wanted)
    RETURNING iv.interviewer_email
), added AS (
    INSERT INTO vetchium.org_provider_interview_interviewers (
        org_interview_id, interviewer_email
    )
    SELECT updated.org_interview_id, wanted.email_address
    FROM updated CROSS JOIN wanted
    ON CONFLICT DO NOTHING
    RETURNING interviewer_email
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM updated) AS updated_rows,
    (SELECT count(*) FROM removed) AS removed_rows,
    (SELECT count(*) FROM added) AS added_rows;

-- Feedback is stored once per interviewer, for an interview recorded as
-- completed; the table's keys refuse a second row or a non-interviewer.
-- name: SubmitProviderInterviewFeedback :one
WITH changed AS (
    UPDATE vetchium.org_applications AS a
    SET version = a.version + 1, updated_at = now()
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state = 'in_pipeline'
      AND EXISTS (
          SELECT 1
          FROM vetchium.org_interviews AS i
          JOIN vetchium.org_provider_interview_interviewers AS iv
              ON iv.org_interview_id = i.org_interview_id
             AND iv.interviewer_email = sqlc.arg(actor_email)::text
          WHERE i.org_application_id = a.org_application_id
            AND i.interview_number = sqlc.arg(interview_number)::integer
            AND i.performer_engagement_id = sqlc.arg(engagement_id)
            AND i.interview_state = 'completed'
            AND NOT EXISTS (
                SELECT 1 FROM vetchium.org_provider_interview_feedback AS f
                WHERE f.org_interview_id = i.org_interview_id
                  AND f.interviewer_email = iv.interviewer_email
            )
      )
    RETURNING a.org_application_id
), stored AS (
    INSERT INTO vetchium.org_provider_interview_feedback (
        org_interview_id, interviewer_email, recommendation, notes
    )
    SELECT i.org_interview_id, sqlc.arg(actor_email)::text,
        (sqlc.arg(recommendation)::text)::vetchium.org_interview_recommendation,
        sqlc.arg(notes)::text
    FROM changed
    JOIN vetchium.org_interviews AS i
        ON i.org_application_id = changed.org_application_id
       AND i.interview_number = sqlc.arg(interview_number)::integer
    RETURNING org_interview_id
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM stored) AS stored_rows;

-- Marks the result a statement of org_application_results.sql just stored as
-- the provider's. Run in the same transaction.
-- name: SetAssessmentPerformer :execrows
UPDATE vetchium.org_application_assessments AS x
SET performer_engagement_id = sqlc.arg(engagement_id),
    recorded_by_email = sqlc.arg(actor_email)::text
WHERE x.org_application_id = sqlc.arg(application_id)
  AND x.org_opening_stage_id = sqlc.arg(stage_id);

-- name: SetBackgroundCheckResultPerformer :execrows
UPDATE vetchium.org_background_check_results AS r
SET recorded_by_email = sqlc.arg(actor_email)::text
FROM vetchium.org_background_checks AS b
WHERE r.org_background_check_id = b.org_background_check_id
  AND b.org_application_id = sqlc.arg(application_id)
  AND b.org_opening_stage_id = sqlc.arg(stage_id)
  AND b.performer_engagement_id = sqlc.arg(engagement_id)
  AND r.check_type = sqlc.arg(check_type)::text;

-- The routed work of a provider across the client Orgs of this tenant, in the
-- order (bucket, sort, work id): a candidacy with an upcoming interview of the
-- provider's first, soonest first; then the rest, newest routed first.
-- name: ListProviderWork :many
WITH work AS (
    SELECT rt.route_id AS work_id, eng.engagement_id,
        snap.consumer_domain, snap.consumer_display_name,
        eng.capability_oid, o.opening_number,
        COALESCE(c.title, '')::text AS opening_title,
        c.employing_country, st.name AS stage_name,
        COALESCE(a.snapshot ->> 'display_name', '')::text AS applicant_name,
        rt.routed_at,
        vetchium.provider_work_status(a.org_application_id,
            a.current_stage_id, eng.engagement_id) AS work_status,
        (
            SELECT min(i.starts_at) FROM vetchium.org_interviews AS i
            WHERE i.org_application_id = a.org_application_id
              AND i.performer_engagement_id = eng.engagement_id
              AND i.interview_state = 'scheduled' AND i.starts_at > now()
        )::timestamptz AS next_interview_at
    FROM vetchium.org_application_routes AS rt
    JOIN vetchium.org_engagement_assignments AS asg
        ON asg.assignment_id = rt.assignment_id
    JOIN vetchium.org_engagements AS eng
        ON eng.engagement_id = asg.engagement_id
    JOIN vetchium.org_engagement_snapshots AS snap
        ON snap.engagement_id = eng.engagement_id
    JOIN vetchium.org_applications AS a
        ON a.org_application_id = rt.org_application_id
    JOIN vetchium.org_openings AS o ON o.org_opening_id = a.org_opening_id
    JOIN vetchium.org_opening_stages AS st
        ON st.org_opening_stage_id = a.current_stage_id
    LEFT JOIN vetchium.org_opening_contents AS c
        ON c.org_opening_id = o.org_opening_id AND c.slot = 'live'
    WHERE eng.provider_org_did = sqlc.arg(provider_org_did)
      AND eng.engagement_state = 'active'
      AND o.org_did = eng.consumer_org_did
      AND asg.org_opening_stage_id = a.current_stage_id
      AND a.application_state = 'in_pipeline'
      AND a.removed_at IS NULL
      AND (sqlc.narg(client_domain)::text IS NULL
          OR snap.consumer_domain = sqlc.narg(client_domain)::text)
      AND (sqlc.narg(capability_oid)::text IS NULL
          OR eng.capability_oid = sqlc.narg(capability_oid)::text)
      AND (sqlc.narg(opening_number)::integer IS NULL
          OR o.opening_number = sqlc.narg(opening_number)::integer)
      AND (sqlc.narg(stage_name)::text IS NULL
          OR st.name = sqlc.narg(stage_name)::text)
), keyed AS (
    SELECT work.*,
        CASE WHEN next_interview_at IS NULL THEN 1 ELSE 0 END::integer AS bucket,
        CASE WHEN next_interview_at IS NULL
            THEN -(extract(epoch FROM routed_at) * 1000000)::bigint
            ELSE (extract(epoch FROM next_interview_at) * 1000000)::bigint
        END AS sort_key
    FROM work
    WHERE (sqlc.narg(work_status)::text IS NULL
        OR work_status = sqlc.narg(work_status)::text)
)
SELECT keyed.work_id, keyed.engagement_id, keyed.consumer_domain,
    keyed.consumer_display_name, keyed.capability_oid, keyed.opening_number,
    keyed.opening_title, keyed.employing_country, keyed.stage_name,
    keyed.applicant_name, keyed.routed_at, keyed.work_status,
    keyed.next_interview_at, keyed.bucket, keyed.sort_key
FROM keyed
WHERE sqlc.narg(after_bucket)::integer IS NULL
   OR (keyed.bucket, keyed.sort_key, keyed.work_id) >
      (sqlc.narg(after_bucket)::integer, sqlc.narg(after_sort)::bigint,
       sqlc.narg(after_work_id)::uuid)
ORDER BY keyed.bucket, keyed.sort_key, keyed.work_id
LIMIT sqlc.arg(page_limit);

-- One routed candidacy and the provider's own work on it: the snapshot, the
-- cover note, the stage, and the interviews, result, and check consent that
-- this engagement performed. Nothing else of the candidacy is read.
-- name: GetProviderWork :one
SELECT rt.route_id AS work_id, eng.engagement_id,
    snap.consumer_domain, snap.consumer_display_name,
    eng.capability_oid, o.opening_number,
    COALESCE(c.title, '')::text AS opening_title,
    c.employing_country, st.name AS stage_name,
    COALESCE(a.snapshot ->> 'display_name', '')::text AS applicant_name,
    a.snapshot, a.cover_note, rt.routed_at,
    vetchium.provider_work_status(a.org_application_id,
        a.current_stage_id, eng.engagement_id) AS work_status,
    (
        SELECT min(i.starts_at) FROM vetchium.org_interviews AS i
        WHERE i.org_application_id = a.org_application_id
          AND i.performer_engagement_id = eng.engagement_id
          AND i.interview_state = 'scheduled' AND i.starts_at > now()
    )::timestamptz AS next_interview_at,
    COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'interview_number', i.interview_number,
            'stage', jsonb_build_object('id', s.org_opening_stage_id,
                'name', s.name, 'kind', s.stage_kind),
            'starts_at', i.starts_at,
            'duration_minutes', i.duration_minutes,
            'mode', i.interview_mode, 'video_url', i.video_url,
            'location', i.location, 'state', i.interview_state,
            'applicant_response', i.applicant_response,
            'reschedule_note', i.reschedule_note,
            'interviewers', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'email', iv.interviewer_email,
                    'feedback_submitted', f.interviewer_email IS NOT NULL
                ) ORDER BY iv.interviewer_email)
                FROM vetchium.org_provider_interview_interviewers AS iv
                LEFT JOIN vetchium.org_provider_interview_feedback AS f
                    ON f.org_interview_id = iv.org_interview_id
                   AND f.interviewer_email = iv.interviewer_email
                WHERE iv.org_interview_id = i.org_interview_id
            ), '[]'::jsonb),
            'feedback', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'interviewer_email', fb.interviewer_email,
                    'recommendation', fb.recommendation,
                    'notes', fb.notes, 'submitted_at', fb.submitted_at
                ) ORDER BY fb.submitted_at, fb.interviewer_email)
                FROM vetchium.org_provider_interview_feedback AS fb
                WHERE fb.org_interview_id = i.org_interview_id
            ), '[]'::jsonb)
        ) ORDER BY i.starts_at, i.interview_number)
        FROM vetchium.org_interviews AS i
        JOIN vetchium.org_opening_stages AS s
            ON s.org_opening_stage_id = i.org_opening_stage_id
        WHERE i.org_application_id = a.org_application_id
          AND i.performer_engagement_id = eng.engagement_id
    ), '[]'::jsonb)::jsonb AS interviews,
    (
        SELECT jsonb_build_object(
            'stage', jsonb_build_object('id', s.org_opening_stage_id,
                'name', s.name, 'kind', s.stage_kind),
            'outcome', x.outcome, 'score', x.score, 'notes', x.notes,
            'report_url', x.report_url,
            'recorded_by_email', x.recorded_by_email,
            'recorded_at', x.recorded_at)
        FROM vetchium.org_application_assessments AS x
        JOIN vetchium.org_opening_stages AS s
            ON s.org_opening_stage_id = x.org_opening_stage_id
        WHERE x.org_application_id = a.org_application_id
          AND x.org_opening_stage_id = a.current_stage_id
          AND x.performer_engagement_id = eng.engagement_id
    )::jsonb AS assessment,
    (
        SELECT jsonb_build_object(
            'check_number', b.check_number,
            'stage', jsonb_build_object('id', s.org_opening_stage_id,
                'name', s.name, 'kind', s.stage_kind),
            'consent_state', b.consent_state,
            'check_types', to_jsonb(b.check_types), 'performer', 'provider',
            'consent_disclosure', b.consent_disclosure,
            'requested_at', b.requested_at, 'responded_at', b.responded_at,
            'results', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'check_type', r.check_type, 'outcome', r.outcome,
                    'notes', r.notes, 'report_url', r.report_url,
                    'recorded_by_email', r.recorded_by_email,
                    'recorded_at', r.recorded_at
                ) ORDER BY r.recorded_at, r.check_type)
                FROM vetchium.org_background_check_results AS r
                WHERE r.org_background_check_id = b.org_background_check_id
            ), '[]'::jsonb))
        FROM vetchium.org_background_checks AS b
        JOIN vetchium.org_opening_stages AS s
            ON s.org_opening_stage_id = b.org_opening_stage_id
        WHERE b.org_application_id = a.org_application_id
          AND b.org_opening_stage_id = a.current_stage_id
          AND b.performer_engagement_id = eng.engagement_id
        ORDER BY b.check_number DESC
        LIMIT 1
    )::jsonb AS background_check
FROM vetchium.org_application_routes AS rt
JOIN vetchium.org_engagement_assignments AS asg
    ON asg.assignment_id = rt.assignment_id
JOIN vetchium.org_engagements AS eng ON eng.engagement_id = asg.engagement_id
JOIN vetchium.org_engagement_snapshots AS snap
    ON snap.engagement_id = eng.engagement_id
JOIN vetchium.org_applications AS a
    ON a.org_application_id = rt.org_application_id
JOIN vetchium.org_openings AS o ON o.org_opening_id = a.org_opening_id
JOIN vetchium.org_opening_stages AS st
    ON st.org_opening_stage_id = a.current_stage_id
LEFT JOIN vetchium.org_opening_contents AS c
    ON c.org_opening_id = o.org_opening_id AND c.slot = 'live'
WHERE rt.route_id = sqlc.arg(work_id)
  AND eng.engagement_id = sqlc.arg(engagement_id)
  AND eng.provider_org_did = sqlc.arg(provider_org_did)
  AND eng.engagement_state = 'active'
  AND o.org_did = eng.consumer_org_did
  AND asg.org_opening_stage_id = a.current_stage_id
  AND a.application_state = 'in_pipeline'
  AND a.removed_at IS NULL;

-- The Openings assigned whole to the provider's `sourcing` engagements.
-- search matches the live title case-insensitively (strpos, so no pattern
-- escaping) or the Opening number exactly. owned_jobs names Jobs as
-- "<engagement id>/<opening number>"; NULL means every Job.
-- name: ListProviderJobs :many
SELECT asg.assignment_id, eng.engagement_id,
    snap.consumer_domain, snap.consumer_display_name,
    o.opening_number, COALESCE(c.title, '')::text AS opening_title,
    c.employing_country, o.opening_state, asg.assigned_at,
    (
        SELECT count(*)
        FROM vetchium.org_applications AS a
        WHERE a.org_opening_id = o.org_opening_id
          AND a.credited_engagement_id = eng.engagement_id
          AND a.removed_at IS NULL
    )::integer AS credited_count
FROM vetchium.org_engagement_assignments AS asg
JOIN vetchium.org_engagements AS eng ON eng.engagement_id = asg.engagement_id
JOIN vetchium.org_engagement_snapshots AS snap
    ON snap.engagement_id = eng.engagement_id
JOIN vetchium.org_openings AS o ON o.org_opening_id = asg.org_opening_id
LEFT JOIN vetchium.org_opening_contents AS c
    ON c.org_opening_id = o.org_opening_id AND c.slot = 'live'
WHERE eng.provider_org_did = sqlc.arg(provider_org_did)
  AND eng.engagement_state = 'active'
  AND eng.capability_oid = 'sourcing'
  AND asg.org_opening_stage_id IS NULL
  AND o.org_did = eng.consumer_org_did
  AND o.opening_state = (sqlc.arg(opening_state)::text)::vetchium.org_opening_state
  AND (sqlc.narg(client_domain)::text IS NULL
      OR snap.consumer_domain = sqlc.narg(client_domain)::text)
  AND (sqlc.narg(search)::text IS NULL
      OR strpos(lower(COALESCE(c.title, '')),
          lower(sqlc.narg(search)::text)) > 0
      OR o.opening_number::text = sqlc.narg(search)::text)
  AND (sqlc.narg(employing_country)::text IS NULL
      OR c.employing_country = sqlc.narg(employing_country)::text)
  AND (sqlc.narg(owned_jobs)::text[] IS NULL
      OR eng.engagement_id::text || '/' || o.opening_number::text
          = ANY (sqlc.narg(owned_jobs)::text[]))
  AND (sqlc.narg(after_assigned_at)::timestamptz IS NULL
      OR (asg.assigned_at, asg.assignment_id) <
         (sqlc.narg(after_assigned_at)::timestamptz,
          sqlc.narg(after_assignment_id)::uuid))
ORDER BY asg.assigned_at DESC, asg.assignment_id DESC
LIMIT sqlc.arg(page_limit);

-- One assigned Opening, whatever its state.
-- name: GetProviderJob :one
SELECT asg.assignment_id, eng.engagement_id,
    snap.consumer_domain, snap.consumer_display_name,
    o.opening_number,
    COALESCE(c.title, '')::text AS opening_title,
    c.employing_country, o.opening_state, asg.assigned_at,
    (
        SELECT count(*)
        FROM vetchium.org_applications AS a
        WHERE a.org_opening_id = o.org_opening_id
          AND a.credited_engagement_id = eng.engagement_id
          AND a.removed_at IS NULL
    )::integer AS credited_count,
    (
        SELECT jsonb_strip_nulls(jsonb_build_object(
            'title', lc.title,
            'description', lc.description,
            'language', lc.language,
            'employing_country', lc.employing_country,
            'work_arrangement', lc.work_arrangement,
            'location_details', lc.location_details,
            'remote_eligibility', CASE WHEN lc.remote_eligibility IS NULL
                THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
                    'kind', lc.remote_eligibility,
                    'countries', lc.remote_countries)) END,
            'employment_type', lc.employment_type,
            'positions', lc.positions,
            'experience_years', CASE WHEN lc.experience_min IS NULL
                AND lc.experience_max IS NULL THEN NULL
                ELSE jsonb_strip_nulls(jsonb_build_object(
                    'min', lc.experience_min, 'max', lc.experience_max)) END,
            'minimum_education', lc.minimum_education,
            'salary', CASE WHEN lc.salary_currency IS NULL THEN NULL
                ELSE jsonb_build_object('currency', lc.salary_currency,
                    'min', lc.salary_min, 'max', lc.salary_max,
                    'period', lc.salary_period) END
        ))
        FROM vetchium.org_opening_contents AS lc
        WHERE lc.org_opening_id = o.org_opening_id AND lc.slot = 'live'
    )::jsonb AS live_content
FROM vetchium.org_engagement_assignments AS asg
JOIN vetchium.org_engagements AS eng ON eng.engagement_id = asg.engagement_id
JOIN vetchium.org_engagement_snapshots AS snap
    ON snap.engagement_id = eng.engagement_id
JOIN vetchium.org_openings AS o ON o.org_opening_id = asg.org_opening_id
LEFT JOIN vetchium.org_opening_contents AS c
    ON c.org_opening_id = o.org_opening_id AND c.slot = 'live'
WHERE eng.engagement_id = sqlc.arg(engagement_id)
  AND eng.provider_org_did = sqlc.arg(provider_org_did)
  AND eng.engagement_state = 'active'
  AND eng.capability_oid = 'sourcing'
  AND asg.org_opening_stage_id IS NULL
  AND o.org_did = eng.consumer_org_did
  AND o.opening_number = sqlc.arg(opening_number)::integer;

-- What the work is waiting for now; a write answers with it.
-- name: GetProviderWorkStatus :one
SELECT vetchium.provider_work_status(a.org_application_id,
    a.current_stage_id, sqlc.arg(engagement_id)::uuid)::text AS work_status
FROM vetchium.org_applications AS a
WHERE a.org_application_id = sqlc.arg(application_id);

-- The addresses that are not active users of the provider Org holding
-- org:fulfil_engagements, who alone may interview for its work (MKT-WRK-002).
-- name: ListUnavailableProviderInterviewers :many
SELECT wanted.email_address::text AS email_address
FROM unnest(sqlc.arg(interviewer_emails)::text[]) AS wanted(email_address)
WHERE NOT EXISTS (
    SELECT 1
    FROM vetchium.org_users AS u
    JOIN vetchium.org_effective_permissions AS ep
        ON ep.org_user_id = u.org_user_id
    WHERE u.org_did = sqlc.arg(org_did)
      AND u.email_address = wanted.email_address
      AND u.org_user_state = 'active'
      AND ep.permission = 'org:fulfil_engagements'
)
ORDER BY wanted.email_address;

-- The applications credited to this sourcing engagement on this opening.
-- name: ListJobCreditedApplications :many
SELECT a.application_number,
    COALESCE(a.referral_route, '')::text AS referral_route,
    a.application_state,
    st.stage_kind AS current_stage_kind,
    a.created_at AS applied_at
FROM vetchium.org_applications AS a
JOIN vetchium.org_openings AS o ON o.org_opening_id = a.org_opening_id
JOIN vetchium.org_engagements AS eng ON eng.engagement_id = a.credited_engagement_id
LEFT JOIN vetchium.org_opening_stages AS st ON st.org_opening_stage_id = a.current_stage_id
WHERE eng.engagement_id = sqlc.arg(engagement_id)
  AND eng.provider_org_did = sqlc.arg(provider_org_did)
  AND eng.engagement_state = 'active'
  AND o.org_did = eng.consumer_org_did
  AND o.opening_number = sqlc.arg(opening_number)::integer
  AND a.removed_at IS NULL
ORDER BY a.created_at DESC, a.application_number DESC;

-- The applications credited to a provider's active `sourcing` engagements
-- with this tenant's Orgs (MKT-SRC-006), newest first, keyset paginated by
-- (applied_at, engagement_id, opening_number, application_number), all
-- descending. A removed application keeps its credit but leaves the list.
-- name: ListPeerCreditedApplications :many
WITH credited AS (
    SELECT a.application_number, a.referral_route::text AS referral_route,
        a.created_at AS applied_at, eng.engagement_id,
        snap.consumer_domain, snap.consumer_display_name, o.opening_number,
        COALESCE(c.title, '')::text AS opening_title, c.employing_country,
        app.hub_user_did AS applicant_did,
        vetchium.hub_application_status(a.application_state, st.stage_kind)
            AS hub_status
    FROM vetchium.org_applications AS a
    JOIN vetchium.org_openings AS o ON o.org_opening_id = a.org_opening_id
    JOIN vetchium.org_engagements AS eng
        ON eng.engagement_id = a.credited_engagement_id
    JOIN vetchium.org_engagement_snapshots AS snap
        ON snap.engagement_id = eng.engagement_id
    JOIN vetchium.org_applicants AS app
        ON app.org_applicant_id = a.org_applicant_id
    LEFT JOIN vetchium.org_opening_stages AS st
        ON st.org_opening_stage_id = a.current_stage_id
    LEFT JOIN vetchium.org_opening_contents AS c
        ON c.org_opening_id = o.org_opening_id AND c.slot = 'live'
    WHERE eng.provider_org_did = sqlc.arg(provider_org_did)
      AND eng.engagement_state = 'active'
      AND eng.capability_oid = 'sourcing'
      AND o.org_did = eng.consumer_org_did
      AND a.removed_at IS NULL
      AND (sqlc.narg(client_domain)::text IS NULL
          OR snap.consumer_domain = sqlc.narg(client_domain)::text)
      AND (sqlc.narg(opening_number)::integer IS NULL
          OR o.opening_number = sqlc.narg(opening_number)::integer)
      AND (sqlc.narg(referral_route)::text IS NULL
          OR a.referral_route = sqlc.narg(referral_route)::text)
      AND (sqlc.narg(applicant_dids)::uuid[] IS NULL
          OR app.hub_user_did = ANY(sqlc.narg(applicant_dids)::uuid[]))
)
SELECT credited.application_number, credited.referral_route,
    credited.applied_at, credited.engagement_id, credited.consumer_domain,
    credited.consumer_display_name, credited.opening_number,
    credited.opening_title, credited.employing_country,
    credited.applicant_did, credited.hub_status::text AS hub_status
FROM credited
WHERE (sqlc.narg(hub_status)::text IS NULL
      OR credited.hub_status = sqlc.narg(hub_status)::text)
  AND (sqlc.narg(after_applied_at)::timestamptz IS NULL
      OR (credited.applied_at, credited.engagement_id, credited.opening_number,
          credited.application_number) <
         (sqlc.narg(after_applied_at)::timestamptz,
          sqlc.narg(after_engagement_id)::uuid,
          sqlc.narg(after_opening_number)::integer,
          sqlc.narg(after_application_number)::integer))
ORDER BY credited.applied_at DESC, credited.engagement_id DESC,
    credited.opening_number DESC, credited.application_number DESC
LIMIT sqlc.arg(page_limit);

-- How many applications credited to the provider each named applicant has
-- with this tenant's Orgs, as ListPeerCreditedApplications lists them.
-- name: CountPeerCreditedApplications :many
SELECT app.hub_user_did AS applicant_did, count(*)::integer AS credited
FROM vetchium.org_applications AS a
JOIN vetchium.org_openings AS o ON o.org_opening_id = a.org_opening_id
JOIN vetchium.org_engagements AS eng
    ON eng.engagement_id = a.credited_engagement_id
JOIN vetchium.org_applicants AS app ON app.org_applicant_id = a.org_applicant_id
WHERE eng.provider_org_did = sqlc.arg(provider_org_did)
  AND eng.engagement_state = 'active'
  AND eng.capability_oid = 'sourcing'
  AND o.org_did = eng.consumer_org_did
  AND a.removed_at IS NULL
  AND app.hub_user_did = ANY(sqlc.arg(applicant_dids)::uuid[])
GROUP BY app.hub_user_did;

-- Contacts suggested for an Opening by this agency.
-- name: ListJobSuggestedContacts :many
SELECT cont.contact_id, cont.display_name, cont.handle, m.sent_at AS suggested_at
FROM vetchium.org_conversation_messages AS m
JOIN vetchium.org_conversations AS conv ON conv.conversation_id = m.conversation_id
JOIN vetchium.org_contacts AS cont ON cont.contact_id = conv.contact_id
WHERE cont.org_did = sqlc.arg(org_did)
  AND m.kind = 'suggestion'
  AND m.consumer_domain = sqlc.arg(consumer_domain)::text
  AND m.opening_number = sqlc.arg(opening_number)::integer
ORDER BY m.sent_at DESC, cont.contact_id DESC;
