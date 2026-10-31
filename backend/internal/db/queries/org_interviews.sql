-- Interviews (agent-guides/hiring-pipeline.md, HP-WRK-002 to HP-WRK-004).
-- Every writer takes the application's row lock first (LockOrgApplicationFor-
-- Write or LockOrgApplicationForApplicant), so numbering, the per-stage limit,
-- and an interview's state never race; each statement repeats the version and
-- state guards anyway. The history and audit rows of an Org write come from
-- RecordOrgApplicationChanges in the same transaction. Timing is judged by
-- the database clock so a decision and its statement agree.

-- feedback_form is the form of the interview's stage, which feedback answers
-- (HP-FRM-003).
-- name: GetOrgInterviewForWrite :one
SELECT i.org_interview_id, i.interview_state, i.applicant_response,
    (i.starts_at <= now())::boolean AS started,
    (
        SELECT s.feedback_form FROM vetchium.org_opening_stages AS s
        WHERE s.org_opening_stage_id = i.org_opening_stage_id
    )::jsonb AS feedback_form,
    EXISTS (
        SELECT 1 FROM vetchium.org_interview_interviewers AS iv
        WHERE iv.org_interview_id = i.org_interview_id
          AND iv.org_user_id = sqlc.arg(viewer_id)
    ) AS viewer_is_interviewer,
    EXISTS (
        SELECT 1 FROM vetchium.org_interview_feedback AS f
        WHERE f.org_interview_id = i.org_interview_id
          AND f.org_user_id = sqlc.arg(viewer_id)
    ) AS viewer_submitted_feedback
FROM vetchium.org_interviews AS i
WHERE i.org_application_id = sqlc.arg(application_id)
  AND i.interview_number = sqlc.arg(interview_number)::integer;

-- Whether the application has the interview, for the applicant's refusals.
-- name: OrgInterviewExists :one
SELECT EXISTS (
    SELECT 1 FROM vetchium.org_interviews AS i
    WHERE i.org_application_id = sqlc.arg(application_id)
      AND i.interview_number = sqlc.arg(interview_number)::integer
) AS interview_exists;

-- The candidacy must be in_pipeline at an interview stage with room for
-- another interview there (cancelled ones do not count). The interviewers
-- must all be active users of the Org; otherwise nothing changes and
-- invalid_addresses names the unavailable ones.
-- name: ScheduleOrgInterview :one
WITH wanted AS (
    SELECT DISTINCT email_address
    FROM unnest(sqlc.arg(interviewer_emails)::text[]) AS names(email_address)
), resolved AS (
    SELECT wanted.email_address, u.org_user_id
    FROM wanted
    LEFT JOIN vetchium.org_users AS u
      ON u.org_did = sqlc.arg(org_did)
     AND u.email_address = wanted.email_address
     AND u.org_user_state = 'active'
), invalid AS (
    SELECT COALESCE(array_agg(email_address ORDER BY email_address),
        ARRAY[]::text[]) AS addresses
    FROM resolved WHERE org_user_id IS NULL
), app AS (
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
      AND cardinality((SELECT addresses FROM invalid)) = 0
      AND sqlc.arg(starts_at)::timestamptz > now()
    RETURNING a.org_application_id, a.current_stage_id
), created AS (
    INSERT INTO vetchium.org_interviews (
        org_interview_id, org_application_id, interview_number,
        org_opening_stage_id, starts_at, duration_minutes, interview_mode,
        video_url, location, scheduled_by
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
        sqlc.arg(actor_id)
    FROM changed
    RETURNING org_interview_id, interview_number
), members AS (
    INSERT INTO vetchium.org_interview_interviewers (
        org_interview_id, org_user_id
    )
    SELECT created.org_interview_id, resolved.org_user_id
    FROM created CROSS JOIN resolved
    RETURNING org_user_id
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM created) AS created_rows,
    (SELECT count(*) FROM members) AS member_rows,
    COALESCE((SELECT interview_number FROM created), 0)::integer
        AS interview_number,
    to_jsonb((SELECT addresses FROM invalid)) AS invalid_addresses,
    COALESCE((SELECT stage_interviews FROM app), 0)::integer
        AS stage_interviews;

-- Replaces the details and interviewers of an upcoming interview. A change
-- of time, duration, or mode details resets the applicant's response
-- (HP-WRK-003); a change of interviewers alone keeps it. Only removed
-- interviewers are deleted and only new ones inserted.
-- name: ChangeOrgInterview :one
WITH target AS (
    SELECT i.org_interview_id, i.org_application_id
    FROM vetchium.org_interviews AS i
    WHERE i.org_application_id = sqlc.arg(application_id)
      AND i.interview_number = sqlc.arg(interview_number)::integer
      AND i.interview_state = 'scheduled'
      AND i.starts_at > now()
), wanted AS (
    SELECT DISTINCT email_address
    FROM unnest(sqlc.arg(interviewer_emails)::text[]) AS names(email_address)
), resolved AS (
    SELECT wanted.email_address, u.org_user_id
    FROM wanted
    LEFT JOIN vetchium.org_users AS u
      ON u.org_did = sqlc.arg(org_did)
     AND u.email_address = wanted.email_address
     AND u.org_user_state = 'active'
), invalid AS (
    SELECT COALESCE(array_agg(email_address ORDER BY email_address),
        ARRAY[]::text[]) AS addresses
    FROM resolved WHERE org_user_id IS NULL
), changed AS (
    UPDATE vetchium.org_applications AS a
    SET version = a.version + 1, updated_at = now()
    FROM target
    WHERE a.org_application_id = target.org_application_id
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state IN ('in_pipeline', 'offered', 'offer_accepted')
      AND cardinality((SELECT addresses FROM invalid)) = 0
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
    DELETE FROM vetchium.org_interview_interviewers AS iv
    USING updated
    WHERE iv.org_interview_id = updated.org_interview_id
      AND iv.org_user_id NOT IN (
          SELECT r.org_user_id FROM resolved AS r
          WHERE r.org_user_id IS NOT NULL
      )
    RETURNING iv.org_user_id
), added AS (
    INSERT INTO vetchium.org_interview_interviewers (
        org_interview_id, org_user_id
    )
    SELECT updated.org_interview_id, resolved.org_user_id
    FROM updated CROSS JOIN resolved
    ON CONFLICT DO NOTHING
    RETURNING org_user_id
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM updated) AS updated_rows,
    (SELECT count(*) FROM removed) AS removed_rows,
    (SELECT count(*) FROM added) AS added_rows,
    to_jsonb((SELECT addresses FROM invalid)) AS invalid_addresses;

-- name: CancelOrgInterview :one
WITH changed AS (
    UPDATE vetchium.org_applications AS a
    SET version = a.version + 1, updated_at = now()
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state IN ('in_pipeline', 'offered', 'offer_accepted')
      AND EXISTS (
          SELECT 1 FROM vetchium.org_interviews AS i
          WHERE i.org_application_id = a.org_application_id
            AND i.interview_number = sqlc.arg(interview_number)::integer
            AND i.interview_state = 'scheduled'
            AND i.starts_at > now()
      )
    RETURNING a.org_application_id
), cancelled AS (
    UPDATE vetchium.org_interviews AS i
    SET interview_state = 'cancelled', ended_at = now(), updated_at = now()
    FROM changed
    WHERE i.org_application_id = changed.org_application_id
      AND i.interview_number = sqlc.arg(interview_number)::integer
      AND i.interview_state = 'scheduled'
      AND i.starts_at > now()
    RETURNING i.org_interview_id
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM cancelled) AS cancelled_rows;

-- After the start, an interviewer of the interview or someone who acts on the
-- Opening's applications records what happened. outcome is completed or
-- no_show.
-- name: RecordOrgInterviewOutcome :one
WITH changed AS (
    UPDATE vetchium.org_applications AS a
    SET version = a.version + 1, updated_at = now()
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND EXISTS (
          SELECT 1 FROM vetchium.org_interviews AS i
          WHERE i.org_application_id = a.org_application_id
            AND i.interview_number = sqlc.arg(interview_number)::integer
            AND i.interview_state = 'scheduled'
            AND i.starts_at <= now()
            AND (sqlc.arg(can_act)::boolean OR EXISTS (
                SELECT 1 FROM vetchium.org_interview_interviewers AS iv
                WHERE iv.org_interview_id = i.org_interview_id
                  AND iv.org_user_id = sqlc.arg(actor_id)
            ))
      )
    RETURNING a.org_application_id
), recorded AS (
    UPDATE vetchium.org_interviews AS i
    SET interview_state = (sqlc.arg(outcome)::text)::vetchium.org_interview_state,
        ended_at = now(), updated_at = now()
    FROM changed
    WHERE i.org_application_id = changed.org_application_id
      AND i.interview_number = sqlc.arg(interview_number)::integer
      AND i.interview_state = 'scheduled'
      AND i.starts_at <= now()
    RETURNING i.org_interview_id
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM recorded) AS recorded_rows;

-- Feedback is stored once per interviewer, for an interview recorded as
-- completed; the table's keys refuse a second row or a non-interviewer.
-- name: SubmitOrgInterviewFeedback :one
WITH changed AS (
    UPDATE vetchium.org_applications AS a
    SET version = a.version + 1, updated_at = now()
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND EXISTS (
          SELECT 1
          FROM vetchium.org_interviews AS i
          JOIN vetchium.org_interview_interviewers AS iv
              ON iv.org_interview_id = i.org_interview_id
             AND iv.org_user_id = sqlc.arg(actor_id)
          WHERE i.org_application_id = a.org_application_id
            AND i.interview_number = sqlc.arg(interview_number)::integer
            AND i.interview_state = 'completed'
            AND NOT EXISTS (
                SELECT 1 FROM vetchium.org_interview_feedback AS f
                WHERE f.org_interview_id = i.org_interview_id
                  AND f.org_user_id = iv.org_user_id
            )
      )
    RETURNING a.org_application_id
), stored AS (
    INSERT INTO vetchium.org_interview_feedback (
        org_interview_id, org_user_id, recommendation, notes, criteria_answers
    )
    SELECT i.org_interview_id, sqlc.arg(actor_id),
        (sqlc.arg(recommendation)::text)::vetchium.org_interview_recommendation,
        sqlc.arg(notes)::text, sqlc.arg(criteria_answers)::jsonb
    FROM changed
    JOIN vetchium.org_interviews AS i
        ON i.org_application_id = changed.org_application_id
       AND i.interview_number = sqlc.arg(interview_number)::integer
    RETURNING org_interview_id
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM stored) AS stored_rows;

-- The applicant accepts, or asks to reschedule, an upcoming interview that
-- they have not already answered that way. The caller holds the lock from
-- LockOrgApplicationForApplicant. response is accepted or
-- reschedule_requested; a note goes with a reschedule request only.
-- name: RespondOrgInterview :one
WITH changed AS (
    UPDATE vetchium.org_applications AS a
    SET version = a.version + 1, updated_at = now()
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state IN ('in_pipeline', 'offered', 'offer_accepted')
      AND EXISTS (
          SELECT 1 FROM vetchium.org_interviews AS i
          WHERE i.org_application_id = a.org_application_id
            AND i.interview_number = sqlc.arg(interview_number)::integer
            AND i.interview_state = 'scheduled'
            AND i.starts_at > now()
            AND i.applicant_response <>
                (sqlc.arg(response)::text)::vetchium.org_interview_response
      )
    RETURNING a.org_application_id, a.application_number,
        a.application_state, a.version
), responded AS (
    UPDATE vetchium.org_interviews AS i
    SET applicant_response =
            (sqlc.arg(response)::text)::vetchium.org_interview_response,
        reschedule_note = sqlc.narg(note)::text, updated_at = now()
    FROM changed
    WHERE i.org_application_id = changed.org_application_id
      AND i.interview_number = sqlc.arg(interview_number)::integer
      AND i.interview_state = 'scheduled'
      AND i.starts_at > now()
    RETURNING i.org_interview_id
), history AS (
    INSERT INTO vetchium.org_application_history (
        org_application_history_id, org_application_id, action, actor_kind,
        application_state, application_version, interview_number
    )
    SELECT sqlc.arg(history_id), changed.org_application_id,
        ('interview_' || sqlc.arg(response)::text)::
            vetchium.org_application_history_action,
        'applicant', changed.application_state, changed.version,
        sqlc.arg(interview_number)::integer
    FROM changed
    RETURNING org_application_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id),
        'org.application.interview_' || sqlc.arg(response)::text,
        'org_application',
        sqlc.arg(org_did)::uuid::text || ':' ||
            sqlc.arg(opening_number)::integer::text || ':' ||
            changed.application_number::text,
        'hub_user', sqlc.arg(hub_user_did)::text, sqlc.arg(org_did),
        'federation-command', sqlc.arg(command_id)::text,
        jsonb_build_object('opening_number', sqlc.arg(opening_number)::integer,
            'application_number', changed.application_number,
            'action', 'interview_' || sqlc.arg(response)::text,
            'interview_number', sqlc.arg(interview_number)::integer,
            'state', changed.application_state::text,
            'version', changed.version,
            'source_tenant_id', sqlc.arg(source_tenant_id)::text)
    FROM changed
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM responded) AS responded_rows,
    (SELECT count(*) FROM history) AS history_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- The interviews the caller is an interviewer of, newest scheduled first.
-- The id is a UUIDv7, so its order is scheduling order and serves the keyset
-- through the interviewer index.
-- name: ListOrgInterviewsForInterviewer :many
SELECT i.org_interview_id, o.opening_number, a.application_number,
    COALESCE(a.snapshot ->> 'display_name', '')::text AS display_name,
    i.interview_number, i.starts_at, i.duration_minutes,
    i.interview_mode, i.interview_state, i.applicant_response,
    EXISTS (
        SELECT 1 FROM vetchium.org_interview_feedback AS f
        WHERE f.org_interview_id = i.org_interview_id
          AND f.org_user_id = iv.org_user_id
    ) AS feedback_submitted
FROM vetchium.org_interview_interviewers AS iv
JOIN vetchium.org_interviews AS i ON i.org_interview_id = iv.org_interview_id
JOIN vetchium.org_applications AS a
    ON a.org_application_id = i.org_application_id
JOIN vetchium.org_openings AS o ON o.org_opening_id = a.org_opening_id
WHERE iv.org_user_id = sqlc.arg(viewer_id)
  AND o.org_did = sqlc.arg(org_did)
  AND (sqlc.narg(after_interview_id)::uuid IS NULL
      OR iv.org_interview_id < sqlc.narg(after_interview_id)::uuid)
ORDER BY iv.org_interview_id DESC
LIMIT sqlc.arg(page_limit);

-- One view of the caller's interviews, soonest start first: upcoming
-- (scheduled and not yet over), else feedback due (over, not cancelled or a
-- no-show, without the caller's feedback). The two never share a row. Start
-- order is on another table than the interviewer index, so PostgreSQL sorts
-- the caller's interviews, which that index finds.
-- name: ListOrgInterviewsForInterviewerByStart :many
SELECT i.org_interview_id, o.opening_number, a.application_number,
    COALESCE(a.snapshot ->> 'display_name', '')::text AS display_name,
    i.interview_number, i.starts_at, i.duration_minutes,
    i.interview_mode, i.interview_state, i.applicant_response,
    (f.org_user_id IS NOT NULL)::boolean AS feedback_submitted
FROM vetchium.org_interview_interviewers AS iv
JOIN vetchium.org_interviews AS i ON i.org_interview_id = iv.org_interview_id
JOIN vetchium.org_applications AS a
    ON a.org_application_id = i.org_application_id
JOIN vetchium.org_openings AS o ON o.org_opening_id = a.org_opening_id
LEFT JOIN vetchium.org_interview_feedback AS f
    ON f.org_interview_id = iv.org_interview_id
   AND f.org_user_id = iv.org_user_id
WHERE iv.org_user_id = sqlc.arg(viewer_id)
  AND o.org_did = sqlc.arg(org_did)
  AND CASE WHEN sqlc.arg(feedback_due)::boolean
      THEN f.org_user_id IS NULL AND (
          i.interview_state = 'completed' OR (
              i.interview_state = 'scheduled'
              AND i.starts_at + make_interval(mins => i.duration_minutes)
                  <= now()))
      ELSE i.interview_state = 'scheduled'
          AND i.starts_at + make_interval(mins => i.duration_minutes) > now()
      END
  AND (sqlc.narg(after_starts_at)::timestamptz IS NULL
      OR (i.starts_at, i.org_interview_id) >
         (sqlc.narg(after_starts_at)::timestamptz,
          sqlc.narg(after_interview_id)::uuid))
ORDER BY i.starts_at, i.org_interview_id
LIMIT sqlc.arg(page_limit);

-- The size of each view ListOrgInterviewsForInterviewerByStart reads.
-- name: CountOrgInterviewsForInterviewer :one
SELECT count(*) FILTER (
        WHERE i.interview_state = 'scheduled'
          AND i.starts_at + make_interval(mins => i.duration_minutes) > now()
    )::integer AS upcoming,
    count(*) FILTER (
        WHERE f.org_user_id IS NULL AND (
            i.interview_state = 'completed' OR (
                i.interview_state = 'scheduled'
                AND i.starts_at + make_interval(mins => i.duration_minutes)
                    <= now()))
    )::integer AS feedback_due
FROM vetchium.org_interview_interviewers AS iv
JOIN vetchium.org_interviews AS i ON i.org_interview_id = iv.org_interview_id
JOIN vetchium.org_applications AS a
    ON a.org_application_id = i.org_application_id
JOIN vetchium.org_openings AS o ON o.org_opening_id = a.org_opening_id
LEFT JOIN vetchium.org_interview_feedback AS f
    ON f.org_interview_id = iv.org_interview_id
   AND f.org_user_id = iv.org_user_id
WHERE iv.org_user_id = sqlc.arg(viewer_id)
  AND o.org_did = sqlc.arg(org_did);
