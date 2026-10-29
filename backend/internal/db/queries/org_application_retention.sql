-- Applications whose retention period passed (HP-RET-001): 365 days after
-- a terminal state, and for joined 365 days after joined_on (the separation
-- window closes then). Each arm serves its own partial index. The worker
-- re-checks the same guard in RetainOrgApplication, so a stale list only
-- costs a no-op.
-- name: ListOrgApplicationsDueForRetention :many
SELECT due.org_application_id
FROM (
    (SELECT a.org_application_id, a.updated_at AS due_at
     FROM vetchium.org_applications AS a
     WHERE a.removed_at IS NULL
       AND a.application_state IN
           ('offer_declined', 'did_not_join', 'not_progressing', 'withdrawn')
       AND a.updated_at <= now() - interval '365 days'
     ORDER BY a.updated_at
     LIMIT sqlc.arg(batch_size))
    UNION ALL
    (SELECT a.org_application_id, a.joined_on::timestamptz AS due_at
     FROM vetchium.org_applications AS a
     WHERE a.removed_at IS NULL AND a.application_state = 'joined'
       AND a.joined_on + 365 <= (now() AT TIME ZONE 'UTC')::date
     ORDER BY a.joined_on
     LIMIT sqlc.arg(batch_size))
) AS due
ORDER BY due.due_at, due.org_application_id
LIMIT sqlc.arg(batch_size);

-- Removes one application's personal data in one state-guarded statement
-- (HP-RET-002): the snapshot becomes a placeholder, and the cover note,
-- answers, interviews with their interviewers and feedback, assessments,
-- background checks with their results, and offers are deleted. Numbers,
-- states, dates, stage records, and history stay. An offer's letter is
-- queued for the object-store deletion the delete-offer-letters job already
-- runs. Every delete names its rows, so none relies on the cascade alone.
-- History and audit hold counts, never content. No row is returned when the
-- application is not due or already removed.
-- name: RetainOrgApplication :one
WITH removed AS (
    UPDATE vetchium.org_applications AS a
    SET snapshot = jsonb_build_object('display_name', 'Removed applicant'),
        cover_note = NULL, answers = '[]'::jsonb, removed_at = now(),
        hub_refresh_at = NULL,
        version = a.version + 1
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.removed_at IS NULL
      AND (
          (a.application_state IN
              ('offer_declined', 'did_not_join', 'not_progressing', 'withdrawn')
           AND a.updated_at <= now() - interval '365 days')
          OR (a.application_state = 'joined'
              AND a.joined_on + 365 <= (now() AT TIME ZONE 'UTC')::date)
      )
    RETURNING a.org_application_id, a.org_opening_id, a.org_applicant_id,
        a.application_number, a.application_state, a.version
), feedback AS (
    DELETE FROM vetchium.org_interview_feedback AS f
    USING vetchium.org_interviews AS i, removed
    WHERE f.org_interview_id = i.org_interview_id
      AND i.org_application_id = removed.org_application_id
    RETURNING f.org_interview_id
), interviewers AS (
    DELETE FROM vetchium.org_interview_interviewers AS iv
    USING vetchium.org_interviews AS i, removed
    WHERE iv.org_interview_id = i.org_interview_id
      AND i.org_application_id = removed.org_application_id
    RETURNING iv.org_interview_id
), provider_feedback AS (
    DELETE FROM vetchium.org_provider_interview_feedback AS f
    USING vetchium.org_interviews AS i, removed
    WHERE f.org_interview_id = i.org_interview_id
      AND i.org_application_id = removed.org_application_id
    RETURNING f.org_interview_id
), provider_interviewers AS (
    DELETE FROM vetchium.org_provider_interview_interviewers AS iv
    USING vetchium.org_interviews AS i, removed
    WHERE iv.org_interview_id = i.org_interview_id
      AND i.org_application_id = removed.org_application_id
    RETURNING iv.org_interview_id
), interviews AS (
    DELETE FROM vetchium.org_interviews AS i
    USING removed
    WHERE i.org_application_id = removed.org_application_id
    RETURNING i.org_interview_id
), assessments AS (
    DELETE FROM vetchium.org_application_assessments AS s
    USING removed
    WHERE s.org_application_id = removed.org_application_id
    RETURNING s.org_application_id
), results AS (
    DELETE FROM vetchium.org_background_check_results AS r
    USING vetchium.org_background_checks AS b, removed
    WHERE r.org_background_check_id = b.org_background_check_id
      AND b.org_application_id = removed.org_application_id
    RETURNING r.org_background_check_id
), checks AS (
    DELETE FROM vetchium.org_background_checks AS b
    USING removed
    WHERE b.org_application_id = removed.org_application_id
    RETURNING b.org_background_check_id
), offers AS (
    DELETE FROM vetchium.org_application_offers AS o
    USING removed
    WHERE o.org_application_id = removed.org_application_id
    RETURNING o.letter_object_id
), letters AS (
    UPDATE vetchium.org_offer_letter_objects AS l
    SET state = 'pending_delete', upload_expires_at = NULL,
        delete_requested_at = now(), next_attempt_at = now()
    WHERE l.object_id IN (SELECT letter_object_id FROM offers)
    RETURNING l.object_id
), facts AS (
    UPDATE vetchium.org_activity_facts AS f
    SET applicant_display_name = ''
    FROM removed
    WHERE f.org_application_id = removed.org_application_id
    RETURNING f.fact_id
), history AS (
    INSERT INTO vetchium.org_application_history (
        org_application_history_id, org_application_id, action, actor_kind,
        application_state, application_version, created_at
    )
    SELECT gen_random_uuid(), removed.org_application_id, 'removed', 'system',
        removed.application_state, removed.version, clock_timestamp()
    FROM removed
    RETURNING org_application_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.application.removed',
        'org_application',
        o.org_did::text || ':' || o.opening_number::text || ':' ||
            removed.application_number::text,
        'worker', 'application-retention', o.org_did, 'workers',
        jsonb_build_object('opening_number', o.opening_number,
            'application_number', removed.application_number,
            'state', removed.application_state::text,
            'version', removed.version,
            'interviews', (SELECT count(*) FROM interviews),
            'feedback', (SELECT count(*) FROM feedback),
            'assessments', (SELECT count(*) FROM assessments),
            'background_checks', (SELECT count(*) FROM checks),
            'offers', (SELECT count(*) FROM offers))
    FROM removed
    JOIN vetchium.org_openings AS o ON o.org_opening_id = removed.org_opening_id
    RETURNING audit_event_id
)
SELECT applicant.hub_user_did, o.org_did, o.opening_number,
    removed.application_number, removed.version,
    (SELECT count(*) FROM history) AS history_rows,
    (SELECT count(*) FROM audit) AS audit_rows,
    (SELECT count(*) FROM offers) AS offer_rows,
    (SELECT count(*) FROM letters) AS letter_rows,
    (SELECT count(*) FROM interviewers) AS interviewer_rows
FROM removed
JOIN vetchium.org_openings AS o ON o.org_opening_id = removed.org_opening_id
JOIN vetchium.org_applicants AS applicant
    ON applicant.org_applicant_id = removed.org_applicant_id;
