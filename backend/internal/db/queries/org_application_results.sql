-- Assessment and background-check results (agent-guides/hiring-pipeline.md,
-- HP-WRK-005 and HP-WRK-006). Every Org writer takes the application's row
-- lock first (LockOrgApplicationForWrite); each statement repeats the version
-- and state guards. The history and audit rows of an Org write come from
-- RecordOrgApplicationChanges in the same transaction. Recording the last
-- result of a stage completes the stage in the same statement, since only a
-- review stage is completed by hand (HP-WRK-001).

-- The stage must be the candidacy's current assessment stage and still
-- pending, which makes the result once-only.
-- name: RecordOrgAssessmentResult :one
WITH changed AS (
    UPDATE vetchium.org_applications AS a
    SET version = a.version + 1, updated_at = now()
    FROM vetchium.org_opening_stages AS s
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state = 'in_pipeline'
      AND s.org_opening_stage_id = a.current_stage_id
      AND s.stage_kind = 'assessment'
      AND EXISTS (
          SELECT 1 FROM vetchium.org_application_stages AS r
          WHERE r.org_application_id = a.org_application_id
            AND r.org_opening_stage_id = a.current_stage_id
            AND r.stage_status = 'pending'
      )
    RETURNING a.org_application_id, a.current_stage_id
), stored AS (
    INSERT INTO vetchium.org_application_assessments (
        org_application_id, org_opening_stage_id, outcome, score, notes,
        report_url, recorded_by
    )
    SELECT changed.org_application_id, changed.current_stage_id,
        (sqlc.arg(outcome)::text)::vetchium.org_assessment_outcome,
        sqlc.narg(score)::smallint, sqlc.narg(notes)::text,
        sqlc.narg(report_url)::text, sqlc.arg(actor_id)
    FROM changed
    RETURNING org_application_id
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
    (SELECT count(*) FROM stored) AS stored_rows,
    (SELECT count(*) FROM completed) AS completed_rows;

-- The consent request of the candidacy's current stage that is still active
-- (requested or given), with the types already recorded.
-- name: GetOrgBackgroundCheckForWrite :one
SELECT b.org_background_check_id, b.consent_state, b.check_types,
    b.performer_engagement_id,
    COALESCE((
        SELECT array_agg(r.check_type ORDER BY r.check_type)
        FROM vetchium.org_background_check_results AS r
        WHERE r.org_background_check_id = b.org_background_check_id
    ), ARRAY[]::text[])::text[] AS recorded_types
FROM vetchium.org_background_checks AS b
WHERE b.org_application_id = sqlc.arg(application_id)
  AND b.org_opening_stage_id = sqlc.arg(stage_id)
  AND b.consent_state IN ('requested', 'given');

-- Asks the applicant for consent to run the check types at the candidacy's
-- current background_check stage. One request is active per stage; a declined
-- or ended one lets the Org ask again.
-- name: RequestOrgBackgroundCheckConsent :one
WITH changed AS (
    UPDATE vetchium.org_applications AS a
    SET version = a.version + 1, updated_at = now()
    FROM vetchium.org_opening_stages AS s
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state = 'in_pipeline'
      AND s.org_opening_stage_id = a.current_stage_id
      AND s.stage_kind = 'background_check'
      AND EXISTS (
          SELECT 1 FROM vetchium.org_application_stages AS r
          WHERE r.org_application_id = a.org_application_id
            AND r.org_opening_stage_id = a.current_stage_id
            AND r.stage_status = 'pending'
      )
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_background_checks AS b
          WHERE b.org_application_id = a.org_application_id
            AND b.org_opening_stage_id = a.current_stage_id
            AND b.consent_state IN ('requested', 'given')
      )
    RETURNING a.org_application_id, a.current_stage_id
), created AS (
    INSERT INTO vetchium.org_background_checks (
        org_background_check_id, org_application_id, check_number,
        org_opening_stage_id, check_types, requested_by,
        performer_engagement_id, consent_disclosure
    )
    SELECT sqlc.arg(check_id), changed.org_application_id,
        COALESCE((
            SELECT max(b.check_number)
            FROM vetchium.org_background_checks AS b
            WHERE b.org_application_id = changed.org_application_id
        ), 0) + 1,
        changed.current_stage_id, sqlc.arg(check_types)::text[],
        sqlc.arg(actor_id), sqlc.narg(performer_engagement_id)::uuid,
        sqlc.narg(consent_disclosure)::text
    FROM changed
    RETURNING check_number
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM created) AS created_rows;

-- Records one check's result once the applicant has consented. The result
-- that completes the requested set completes the stage.
-- name: RecordOrgBackgroundCheckResult :one
WITH changed AS (
    UPDATE vetchium.org_applications AS a
    SET version = a.version + 1, updated_at = now()
    FROM vetchium.org_background_checks AS b
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state = 'in_pipeline'
      AND b.org_application_id = a.org_application_id
      AND b.org_opening_stage_id = a.current_stage_id
      AND b.consent_state = 'given'
      AND sqlc.arg(check_type)::text = ANY(b.check_types)
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_background_check_results AS r
          WHERE r.org_background_check_id = b.org_background_check_id
            AND r.check_type = sqlc.arg(check_type)::text
      )
      AND EXISTS (
          SELECT 1 FROM vetchium.org_application_stages AS r
          WHERE r.org_application_id = a.org_application_id
            AND r.org_opening_stage_id = a.current_stage_id
            AND r.stage_status = 'pending'
      )
    RETURNING a.org_application_id, a.current_stage_id,
        b.org_background_check_id,
        (cardinality(b.check_types) = 1 + (
            SELECT count(*) FROM vetchium.org_background_check_results AS r
            WHERE r.org_background_check_id = b.org_background_check_id
        )) AS last_result
), stored AS (
    INSERT INTO vetchium.org_background_check_results (
        org_background_check_id, check_type, outcome, notes, report_url,
        recorded_by
    )
    SELECT changed.org_background_check_id, sqlc.arg(check_type)::text,
        (sqlc.arg(outcome)::text)::vetchium.org_check_outcome,
        sqlc.narg(notes)::text, sqlc.narg(report_url)::text,
        sqlc.arg(actor_id)
    FROM changed
    RETURNING org_background_check_id
), completed AS (
    UPDATE vetchium.org_application_stages AS r
    SET stage_status = 'completed'
    FROM changed
    WHERE changed.last_result
      AND r.org_application_id = changed.org_application_id
      AND r.org_opening_stage_id = changed.current_stage_id
      AND r.stage_status = 'pending'
    RETURNING r.org_application_id
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM stored) AS stored_rows,
    (SELECT count(*) FROM completed) AS completed_rows,
    COALESCE((SELECT bool_or(last_result) FROM changed), false)::boolean
        AS completes_stage;

-- Whether the application has the consent request, for the applicant's
-- refusals.
-- name: OrgBackgroundCheckExists :one
SELECT EXISTS (
    SELECT 1 FROM vetchium.org_background_checks AS b
    WHERE b.org_application_id = sqlc.arg(application_id)
      AND b.check_number = sqlc.arg(check_number)::integer
) AS check_exists;

-- The applicant gives or declines consent to a request still awaiting an
-- answer. The caller holds the lock from LockOrgApplicationForApplicant.
-- response is given or declined; declining completes nothing and the Org
-- decides what follows (HP-HUB-003).
-- name: RespondOrgBackgroundCheckConsent :one
WITH target AS (
    SELECT b.org_background_check_id, b.org_opening_stage_id
    FROM vetchium.org_background_checks AS b
    WHERE b.org_application_id = sqlc.arg(application_id)
      AND b.check_number = sqlc.arg(check_number)::integer
      AND b.consent_state = 'requested'
), changed AS (
    UPDATE vetchium.org_applications AS a
    SET version = a.version + 1, updated_at = now()
    FROM target
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state IN ('in_pipeline', 'offered', 'offer_accepted')
    RETURNING a.org_application_id, a.application_number,
        a.application_state, a.version, target.org_background_check_id,
        target.org_opening_stage_id
), responded AS (
    UPDATE vetchium.org_background_checks AS b
    SET consent_state =
            (sqlc.arg(response)::text)::vetchium.org_consent_state,
        responded_at = now()
    FROM changed
    WHERE b.org_background_check_id = changed.org_background_check_id
      AND b.consent_state = 'requested'
    RETURNING b.org_background_check_id
), history AS (
    INSERT INTO vetchium.org_application_history (
        org_application_history_id, org_application_id, action, actor_kind,
        application_state, application_version, org_opening_stage_id
    )
    SELECT sqlc.arg(history_id), changed.org_application_id,
        ('background_check_consent_' || sqlc.arg(response)::text)::
            vetchium.org_application_history_action,
        'applicant', changed.application_state, changed.version,
        changed.org_opening_stage_id
    FROM changed
    RETURNING org_application_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id),
        'org.application.background_check_consent_' || sqlc.arg(response)::text,
        'org_application',
        sqlc.arg(org_did)::uuid::text || ':' ||
            sqlc.arg(opening_number)::integer::text || ':' ||
            changed.application_number::text,
        'hub_user', sqlc.arg(hub_user_did)::text, sqlc.arg(org_did),
        'federation-command', sqlc.arg(command_id)::text,
        jsonb_build_object('opening_number', sqlc.arg(opening_number)::integer,
            'application_number', changed.application_number,
            'action', 'background_check_consent_' || sqlc.arg(response)::text,
            'check_number', sqlc.arg(check_number)::integer,
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
