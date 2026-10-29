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

-- Read after LockOrgOpeningForApplication, in its own statement, so a revise
-- approval that committed while hub-apply waited for the lock is seen.
-- name: GetOrgOpeningLiveQuestions :one
SELECT COALESCE((
    SELECT c.questions FROM vetchium.org_opening_contents AS c
    WHERE c.org_opening_id = sqlc.arg(org_opening_id) AND c.slot = 'live'
), '[]'::jsonb)::jsonb AS questions;

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
        org_applicant_id, snapshot, cover_note, answers,
        credited_engagement_id, referral_route
    )
    VALUES (
        sqlc.arg(application_id), sqlc.arg(org_opening_id),
        sqlc.arg(application_number)::integer, sqlc.arg(applicant_id),
        sqlc.arg(snapshot)::jsonb, sqlc.narg(cover_note)::text,
        sqlc.arg(answers)::jsonb,
        sqlc.narg(credited_engagement_id)::uuid,
        sqlc.narg(referral_route)::text
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

-- The opening row leads, so a caller who may not read any of the Opening's
-- applications gets no row at all, while one who may and finds nothing gets a
-- single row with a null application number. The join then keeps only the
-- applications the caller reads: an interviewer sees just their candidacies.
-- name: ListOrgApplications :many
SELECT a.application_number, a.application_state, a.version,
    COALESCE(a.snapshot ->> 'display_name', '')::text AS display_name,
    COALESCE(a.snapshot ->> 'resident_country', '')::text AS resident_country,
    (a.removed_at IS NOT NULL)::boolean AS removed,
    stage.org_opening_stage_id AS stage_id, stage.name AS stage_name,
    stage.stage_kind, a.created_at, a.updated_at,
    eng.engagement_id AS route_engagement_id,
    eng.provider_domain AS route_domain,
    eng.provider_display_name AS route_display_name,
    eng.capability_oid AS route_capability, rt.routed_at AS route_routed_at,
    a.credited_engagement_id,
    cred_eng.provider_domain AS credited_provider_domain,
    cred_eng.provider_display_name AS credited_provider_display_name,
    a.referral_route,
    -- The answers to the requested columns, unanswered ones omitted
    -- (HP-QST-007); never a filter or sort key.
    COALESCE((
        SELECT jsonb_agg(jsonb_build_object('question_id', e.entry ->> 'id',
            'value', e.entry -> 'answer') ORDER BY e.position)
        FROM jsonb_array_elements(a.answers) WITH ORDINALITY AS e(entry, position)
        WHERE e.entry ->> 'id' = ANY(sqlc.arg(answer_columns)::text[])
          AND e.entry ? 'answer'
    ), '[]'::jsonb)::jsonb AS column_answers,
    -- The live questions the handler checks answer_columns against.
    CASE WHEN cardinality(sqlc.arg(answer_columns)::text[]) = 0
        THEN '[]'::jsonb
        ELSE COALESCE((
            SELECT c.questions FROM vetchium.org_opening_contents AS c
            WHERE c.org_opening_id = o.org_opening_id AND c.slot = 'live'
        ), '[]'::jsonb)
    END::jsonb AS live_questions
FROM vetchium.org_openings AS o
LEFT JOIN vetchium.org_applications AS a
    ON a.org_opening_id = o.org_opening_id
    AND vetchium.org_user_reads_applications(o.org_opening_id,
        sqlc.arg(viewer_id), a.org_application_id)
    AND a.application_state::text = ANY(sqlc.arg(states)::text[])
    AND (sqlc.narg(pending_action)::text IS NULL OR (
        sqlc.narg(pending_action)::text = 'interview_response' AND EXISTS (
            SELECT 1 FROM vetchium.org_interviews AS i
            WHERE i.org_application_id = a.org_application_id
              AND i.interview_state = 'scheduled' AND i.starts_at > now()
              AND i.applicant_response = 'pending'
        )) OR (
        sqlc.narg(pending_action)::text = 'offer_response'
        AND a.application_state = 'offered' AND EXISTS (
            SELECT 1 FROM vetchium.org_application_offers AS f
            WHERE f.org_application_id = a.org_application_id
              AND f.offer_status = 'extended' AND f.respond_by > now()
        )) OR (
        sqlc.narg(pending_action)::text = 'background_check_consent'
        AND EXISTS (
            SELECT 1 FROM vetchium.org_background_checks AS b
            WHERE b.org_application_id = a.org_application_id
              AND b.consent_state = 'requested'
        )))
    AND (sqlc.narg(routed_engagement_id)::uuid IS NULL OR EXISTS (
        SELECT 1 FROM vetchium.org_application_routes AS filter_rt
        JOIN vetchium.org_engagement_assignments AS filter_asg
            ON filter_asg.assignment_id = filter_rt.assignment_id
        WHERE filter_rt.org_application_id = a.org_application_id
          AND filter_asg.engagement_id = sqlc.narg(routed_engagement_id)::uuid
    ))
    AND (sqlc.narg(stage_id)::uuid IS NULL
        OR a.current_stage_id = sqlc.narg(stage_id)::uuid)
    AND (sqlc.narg(name_query)::text IS NULL OR (
        a.removed_at IS NULL
        AND strpos(lower(a.snapshot ->> 'display_name'),
            lower(sqlc.narg(name_query)::text)) > 0))
    AND (sqlc.narg(credited_agency_domain)::text IS NULL OR EXISTS (
        SELECT 1 FROM vetchium.org_engagements AS filter_cred
        WHERE filter_cred.engagement_id = a.credited_engagement_id
          AND filter_cred.provider_domain = sqlc.narg(credited_agency_domain)::text
    ))
    AND (sqlc.narg(referral_route)::text IS NULL
        OR a.referral_route = sqlc.narg(referral_route)::text)
    AND (sqlc.narg(after_application_number)::integer IS NULL
        OR a.application_number < sqlc.narg(after_application_number)::integer)
LEFT JOIN vetchium.org_opening_stages AS stage
    ON stage.org_opening_stage_id = a.current_stage_id
LEFT JOIN vetchium.org_application_routes AS rt
    ON rt.org_application_id = a.org_application_id
LEFT JOIN vetchium.org_engagement_assignments AS asg
    ON asg.assignment_id = rt.assignment_id
LEFT JOIN vetchium.org_engagements AS eng ON eng.engagement_id = asg.engagement_id
LEFT JOIN vetchium.org_engagements AS cred_eng ON cred_eng.engagement_id = a.credited_engagement_id
WHERE o.org_did = sqlc.arg(org_did)
  AND o.opening_number = sqlc.arg(opening_number)::integer
  AND vetchium.org_user_reads_applications(o.org_opening_id, sqlc.arg(viewer_id))
ORDER BY a.application_number DESC NULLS LAST
LIMIT sqlc.arg(page_limit);

-- An interviewer who reads only their candidacies sees no offers: a letter is
-- for those who read all of the Opening's applications (HP-WRK-008).
-- name: GetOrgApplication :one
SELECT a.application_number, a.application_state, a.version, a.snapshot,
    (a.removed_at IS NOT NULL)::boolean AS removed, a.cover_note, stage.org_opening_stage_id AS stage_id,
    stage.name AS stage_name, stage.stage_kind, a.created_at, a.updated_at,
    a.joined_on, a.separated_on,
    COALESCE((
        SELECT c.positions FROM vetchium.org_opening_contents AS c
        WHERE c.org_opening_id = o.org_opening_id AND c.slot = 'live'
    ), 0)::integer AS positions,
    -- The answers are judged against the live questions (HP-QST-006).
    a.answers,
    COALESCE((
        SELECT c.questions FROM vetchium.org_opening_contents AS c
        WHERE c.org_opening_id = o.org_opening_id AND c.slot = 'live'
    ), '[]'::jsonb)::jsonb AS live_questions,
    (
        SELECT count(*) FROM vetchium.org_applications AS j
        WHERE j.org_opening_id = o.org_opening_id
          AND j.application_state = 'joined'
    )::integer AS joined_count,
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
    ), '[]'::jsonb)::jsonb AS stage_records,
    COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'offer_number', f.offer_number, 'status', f.offer_status,
            'letter_object_id', f.letter_object_id,
            'letter_byte_size', l.byte_size,
            'proposed_joining_date', f.proposed_joining_date,
            'respond_by', f.respond_by, 'extended_at', f.extended_at,
            'ended_at', f.ended_at
        ) ORDER BY f.offer_number DESC)
        FROM vetchium.org_application_offers AS f
        JOIN vetchium.org_offer_letter_objects AS l
            ON l.object_id = f.letter_object_id
        WHERE f.org_application_id = a.org_application_id
          AND vetchium.org_user_reads_all_applications(o.org_opening_id,
              sqlc.arg(viewer_id))
    ), '[]'::jsonb)::jsonb AS offers,
    -- Another interviewer's feedback stays hidden from an interviewer of the
    -- interview until they submit their own (HP-WRK-004).
    COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'interview_number', i.interview_number,
            'stage', jsonb_build_object('id', s.org_opening_stage_id,
                'name', s.name, 'kind', s.stage_kind,
                'feedback_form', s.feedback_form),
            'starts_at', i.starts_at,
            'duration_minutes', i.duration_minutes,
            'mode', i.interview_mode, 'video_url', i.video_url,
            'location', i.location, 'state', i.interview_state,
            'applicant_response', i.applicant_response,
            'reschedule_note', i.reschedule_note,
            'provider', (SELECT jsonb_build_object('domain', pe.provider_domain,
                'display_name', pe.provider_display_name)
             FROM vetchium.org_engagements AS pe
             WHERE pe.engagement_id = i.performer_engagement_id),
            'interviewers', COALESCE((
                SELECT jsonb_agg(x.entry ORDER BY x.email)
                FROM (
                    SELECT u.email_address AS email,
                        jsonb_build_object('email', u.email_address,
                            'feedback_submitted', f.org_user_id IS NOT NULL
                        ) AS entry
                    FROM vetchium.org_interview_interviewers AS iv
                    JOIN vetchium.org_users AS u
                        ON u.org_user_id = iv.org_user_id
                    LEFT JOIN vetchium.org_interview_feedback AS f
                        ON f.org_interview_id = iv.org_interview_id
                       AND f.org_user_id = iv.org_user_id
                    WHERE iv.org_interview_id = i.org_interview_id
                    UNION ALL
                    SELECT piv.interviewer_email,
                        jsonb_build_object('email', piv.interviewer_email,
                            'feedback_submitted', pf.interviewer_email IS NOT NULL
                        )
                    FROM vetchium.org_provider_interview_interviewers AS piv
                    LEFT JOIN vetchium.org_provider_interview_feedback AS pf
                        ON pf.org_interview_id = piv.org_interview_id
                       AND pf.interviewer_email = piv.interviewer_email
                    WHERE piv.org_interview_id = i.org_interview_id
                ) AS x
            ), '[]'::jsonb),
            'feedback', COALESCE((
                SELECT jsonb_agg(x.entry ORDER BY x.submitted_at, x.email)
                FROM (
                    SELECT fb.submitted_at, fu.email_address AS email,
                        jsonb_build_object(
                            'interviewer_email', fu.email_address,
                            'recommendation', fb.recommendation,
                            'notes', fb.notes,
                            'criteria_answers', fb.criteria_answers,
                            'submitted_at', fb.submitted_at) AS entry
                    FROM vetchium.org_interview_feedback AS fb
                    JOIN vetchium.org_users AS fu
                        ON fu.org_user_id = fb.org_user_id
                    WHERE fb.org_interview_id = i.org_interview_id
                      AND (fb.org_user_id = sqlc.arg(viewer_id) OR NOT EXISTS (
                          SELECT 1
                          FROM vetchium.org_interview_interviewers AS me
                          WHERE me.org_interview_id = i.org_interview_id
                            AND me.org_user_id = sqlc.arg(viewer_id)
                            AND NOT EXISTS (
                                SELECT 1 FROM vetchium.org_interview_feedback AS own
                                WHERE own.org_interview_id = me.org_interview_id
                                  AND own.org_user_id = me.org_user_id
                            )
                      ))
                    UNION ALL
                    SELECT pfb.submitted_at, pfb.interviewer_email,
                        jsonb_build_object(
                            'interviewer_email', pfb.interviewer_email,
                            'recommendation', pfb.recommendation,
                            'notes', pfb.notes,
                            'criteria_answers', pfb.criteria_answers,
                            'submitted_at', pfb.submitted_at)
                    FROM vetchium.org_provider_interview_feedback AS pfb
                    WHERE pfb.org_interview_id = i.org_interview_id
                ) AS x
            ), '[]'::jsonb)
        ) ORDER BY i.starts_at, i.interview_number)
        FROM vetchium.org_interviews AS i
        JOIN vetchium.org_opening_stages AS s
            ON s.org_opening_stage_id = i.org_opening_stage_id
        WHERE i.org_application_id = a.org_application_id
    ), '[]'::jsonb)::jsonb AS interviews,
    -- Results are for those who read all of the Opening's applications, as
    -- offers are: an interviewer sees only the interviews of their candidacy.
    COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'stage', jsonb_build_object('id', s.org_opening_stage_id,
                'name', s.name, 'kind', s.stage_kind),
            'outcome', x.outcome, 'score', x.score, 'notes', x.notes,
            'report_url', x.report_url,
            'recorded_by_email', COALESCE(u.email_address, x.recorded_by_email),
            'recorded_at', x.recorded_at,
            'provider', (SELECT jsonb_build_object('domain', pe.provider_domain,
                'display_name', pe.provider_display_name)
             FROM vetchium.org_engagements AS pe
             WHERE pe.engagement_id = x.performer_engagement_id)
        ) ORDER BY s.position)
        FROM vetchium.org_application_assessments AS x
        JOIN vetchium.org_opening_stages AS s
            ON s.org_opening_stage_id = x.org_opening_stage_id
        LEFT JOIN vetchium.org_users AS u ON u.org_user_id = x.recorded_by
        WHERE x.org_application_id = a.org_application_id
          AND vetchium.org_user_reads_all_applications(o.org_opening_id,
              sqlc.arg(viewer_id))
    ), '[]'::jsonb)::jsonb AS assessments,
    COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'check_number', b.check_number,
            'stage', jsonb_build_object('id', s.org_opening_stage_id,
                'name', s.name, 'kind', s.stage_kind),
            'consent_state', b.consent_state,
            'check_types', to_jsonb(b.check_types),
            'performer', CASE WHEN b.performer_engagement_id IS NULL
                THEN 'org' ELSE 'provider' END,
            'provider', (SELECT jsonb_build_object('domain', pe.provider_domain,
                'display_name', pe.provider_display_name)
             FROM vetchium.org_engagements AS pe
             WHERE pe.engagement_id = b.performer_engagement_id),
            'consent_disclosure', b.consent_disclosure,
            'requested_at', b.requested_at, 'responded_at', b.responded_at,
            'results', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'check_type', r.check_type, 'outcome', r.outcome,
                    'notes', r.notes, 'report_url', r.report_url,
                    'recorded_by_email',
                        COALESCE(ru.email_address, r.recorded_by_email),
                    'recorded_at', r.recorded_at
                ) ORDER BY r.recorded_at, r.check_type)
                FROM vetchium.org_background_check_results AS r
                LEFT JOIN vetchium.org_users AS ru
                    ON ru.org_user_id = r.recorded_by
                WHERE r.org_background_check_id = b.org_background_check_id
            ), '[]'::jsonb)
        ) ORDER BY b.check_number)
        FROM vetchium.org_background_checks AS b
        JOIN vetchium.org_opening_stages AS s
            ON s.org_opening_stage_id = b.org_opening_stage_id
        WHERE b.org_application_id = a.org_application_id
          AND vetchium.org_user_reads_all_applications(o.org_opening_id,
              sqlc.arg(viewer_id))
    ), '[]'::jsonb)::jsonb AS background_checks,
    eng.engagement_id AS route_engagement_id,
    eng.provider_domain AS route_domain,
    eng.provider_display_name AS route_display_name,
    eng.capability_oid AS route_capability, rt.routed_at AS route_routed_at,
    a.credited_engagement_id,
    cred_eng.provider_domain AS credited_provider_domain,
    cred_eng.provider_display_name AS credited_provider_display_name,
    a.referral_route
FROM vetchium.org_openings AS o
JOIN vetchium.org_applications AS a ON a.org_opening_id = o.org_opening_id
LEFT JOIN vetchium.org_opening_stages AS stage
    ON stage.org_opening_stage_id = a.current_stage_id
LEFT JOIN vetchium.org_application_routes AS rt
    ON rt.org_application_id = a.org_application_id
LEFT JOIN vetchium.org_engagement_assignments AS asg
    ON asg.assignment_id = rt.assignment_id
LEFT JOIN vetchium.org_engagements AS eng ON eng.engagement_id = asg.engagement_id
LEFT JOIN vetchium.org_engagements AS cred_eng ON cred_eng.engagement_id = a.credited_engagement_id
WHERE o.org_did = sqlc.arg(org_did)
  AND o.opening_number = sqlc.arg(opening_number)::integer
  AND a.application_number = sqlc.arg(application_number)::integer
  AND vetchium.org_user_reads_applications(o.org_opening_id,
      sqlc.arg(viewer_id), a.org_application_id);

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
              AND vetchium.org_user_reads_applications(o.org_opening_id,
                  sqlc.arg(viewer_id), a.org_application_id)
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
                  AND vetchium.org_user_reads_applications(o.org_opening_id,
                      sqlc.arg(viewer_id), a.org_application_id)
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
    h.application_version, h.created_at, h.joined_on, h.separated_on,
    hs.org_opening_stage_id AS stage_id, hs.name AS stage_name,
    hs.stage_kind, h.interview_number
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
LEFT JOIN vetchium.org_opening_stages AS hs
    ON hs.org_opening_stage_id = h.org_opening_stage_id
WHERE o.org_did = sqlc.arg(org_did)
  AND o.opening_number = sqlc.arg(opening_number)::integer
  AND a.application_number = sqlc.arg(application_number)::integer
  AND vetchium.org_user_reads_applications(o.org_opening_id,
      sqlc.arg(viewer_id), a.org_application_id)
ORDER BY h.created_at DESC NULLS LAST, h.org_application_history_id DESC NULLS LAST
LIMIT sqlc.arg(page_limit);

-- What the applicant's home tenant projects for each application
-- (HP-GEN-004), read in the transaction that changed them.
-- name: GetHubApplicationChanges :many
SELECT applicant.hub_user_did, o.org_did, d.domain::text AS org_domain,
    org.display_name AS org_display_name, o.opening_number,
    COALESCE(c.title, '')::text AS opening_title, a.application_number,
    a.application_state, stage.stage_kind, a.version, a.created_at,
    a.updated_at,
    EXISTS (
        SELECT 1 FROM vetchium.org_application_offers AS f
        WHERE f.org_application_id = a.org_application_id
          AND f.offer_status = 'extended' AND f.respond_by > now()
    ) AS offer_awaits_answer,
    EXISTS (
        SELECT 1 FROM vetchium.org_interviews AS i
        WHERE i.org_application_id = a.org_application_id
          AND i.interview_state = 'scheduled' AND i.starts_at > now()
          AND i.applicant_response = 'pending'
    ) AS interview_awaits_response,
    EXISTS (
        SELECT 1 FROM vetchium.org_background_checks AS b
        WHERE b.org_application_id = a.org_application_id
          AND b.consent_state = 'requested'
    ) AS consent_awaits_response
FROM vetchium.org_applications AS a
JOIN vetchium.org_applicants AS applicant
    ON applicant.org_applicant_id = a.org_applicant_id
JOIN vetchium.org_openings AS o ON o.org_opening_id = a.org_opening_id
JOIN vetchium.orgs AS org ON org.org_did = o.org_did
JOIN vetchium.org_domains AS d ON d.org_did = o.org_did
JOIN vetchium.org_opening_contents AS c
    ON c.org_opening_id = o.org_opening_id AND c.slot = 'live'
LEFT JOIN vetchium.org_opening_stages AS stage
    ON stage.org_opening_stage_id = a.current_stage_id
WHERE a.org_application_id = ANY(sqlc.arg(application_ids)::uuid[])
ORDER BY a.application_number;

-- Taken first by hub-withdraw, so the state decision and the update below
-- see the same row. Only the applicant's own application matches.
-- name: LockOrgApplicationForApplicant :one
SELECT a.org_application_id, a.application_state, a.version
FROM vetchium.org_applications AS a
JOIN vetchium.org_openings AS o ON o.org_opening_id = a.org_opening_id
JOIN vetchium.org_applicants AS applicant
    ON applicant.org_applicant_id = a.org_applicant_id
WHERE o.org_did = sqlc.arg(org_did)
  AND o.opening_number = sqlc.arg(opening_number)::integer
  AND a.application_number = sqlc.arg(application_number)::integer
  AND applicant.hub_user_did = sqlc.arg(hub_user_did)
FOR UPDATE OF a;

-- The caller holds the application row lock from
-- LockOrgApplicationForApplicant. An offer awaiting an answer is withdrawn
-- with the application, and upcoming interviews are cancelled (HP-STA-002).
-- name: WithdrawOrgApplication :one
WITH withdrawn AS (
    UPDATE vetchium.org_applications AS a
    SET application_state = 'withdrawn', version = a.version + 1,
        updated_at = now()
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state IN
          ('submitted', 'in_pipeline', 'offered', 'offer_accepted')
    RETURNING a.org_application_id, a.application_number, a.version
), ended AS (
    UPDATE vetchium.org_application_offers AS o
    SET offer_status = 'withdrawn', ended_at = now()
    FROM withdrawn
    WHERE o.org_application_id = withdrawn.org_application_id
      AND o.offer_status = 'extended'
    RETURNING o.org_application_id
), cancelled AS (
    SELECT vetchium.cancel_upcoming_interviews(
        ARRAY(SELECT org_application_id FROM withdrawn)) AS interviews,
        vetchium.end_pending_consents(
        ARRAY(SELECT org_application_id FROM withdrawn)) AS consents,
        vetchium.end_provider_access(
        ARRAY(SELECT org_application_id FROM withdrawn)) AS access
), history AS (
    INSERT INTO vetchium.org_application_history (
        org_application_history_id, org_application_id, action, actor_kind,
        application_state, application_version
    )
    SELECT sqlc.arg(history_id), withdrawn.org_application_id, 'withdrawn',
        'applicant', 'withdrawn', withdrawn.version
    FROM withdrawn
    RETURNING org_application_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.application.withdrawn',
        'org_application',
        sqlc.arg(org_did)::uuid::text || ':' ||
            sqlc.arg(opening_number)::integer::text || ':' ||
            withdrawn.application_number::text,
        'hub_user', sqlc.arg(hub_user_did)::text, sqlc.arg(org_did),
        'federation-command', sqlc.arg(command_id)::text,
        jsonb_build_object('opening_number', sqlc.arg(opening_number)::integer,
            'application_number', withdrawn.application_number,
            'action', 'withdrawn', 'version', withdrawn.version,
            'previous_state', sqlc.arg(previous_state)::text,
            'source_tenant_id', sqlc.arg(source_tenant_id)::text)
    FROM withdrawn
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM withdrawn) AS withdrawn_rows,
    COALESCE((SELECT interviews FROM cancelled), 0)::integer
        AS cancelled_interviews,
    (SELECT count(*) FROM history) AS history_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- The applicant's live read of their own application, addressed by the
-- Org's domain as the Hub sees it. Org suspension does not hide it. The
-- applicant sees the latest offer unless the Org withdrew it.
-- name: GetOrgApplicationForApplicant :one
SELECT d.domain::text AS org_domain, org.display_name AS org_display_name,
    o.opening_number, COALESCE(c.title, '')::text AS opening_title,
    a.application_number, a.application_state, stage.stage_kind,
    -- The applicant's own answers as asked; their currency is the Org's.
    a.answers,
    (offer.offer_number IS NOT NULL)::boolean AS has_offer,
    COALESCE(offer.offer_number, 0)::integer AS offer_number,
    COALESCE(offer.offer_status::text, '')::text AS offer_status,
    offer.letter_object_id,
    COALESCE(offer.letter_byte_size, 0)::integer AS letter_byte_size,
    offer.proposed_joining_date, offer.respond_by, offer.extended_at,
    COALESCE(offer.offer_status = 'extended' AND offer.respond_by > now(),
        false)::boolean AS offer_awaits_answer,
    EXISTS (
        SELECT 1 FROM vetchium.org_interviews AS i
        WHERE i.org_application_id = a.org_application_id
          AND i.interview_state = 'scheduled' AND i.starts_at > now()
          AND i.applicant_response = 'pending'
    ) AS interview_awaits_response,
    EXISTS (
        SELECT 1 FROM vetchium.org_background_checks AS b
        WHERE b.org_application_id = a.org_application_id
          AND b.consent_state = 'requested'
    ) AS consent_awaits_response,
    -- The request the applicant is asked to answer; its result, if any, and
    -- the stage it belongs to are the Org's alone.
    (
        SELECT jsonb_build_object('check_number', b.check_number,
            'check_types', to_jsonb(b.check_types),
            'performer', CASE WHEN b.performer_engagement_id IS NULL
                THEN 'org' ELSE 'provider' END,
            'provider', (SELECT jsonb_build_object('domain', pe.provider_domain,
                'display_name', pe.provider_display_name)
             FROM vetchium.org_engagements AS pe
             WHERE pe.engagement_id = b.performer_engagement_id),
            'disclosure', b.consent_disclosure,
            'requested_at', b.requested_at)
        FROM vetchium.org_background_checks AS b
        WHERE b.org_application_id = a.org_application_id
          AND b.consent_state = 'requested'
    )::jsonb AS background_check,
    -- Cancelled interviews tell the applicant it will not happen; how a
    -- finished one went is the Org's alone (HP-HUB-001).
    COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'interview_number', i.interview_number,
            'state', i.interview_state, 'starts_at', i.starts_at,
            'duration_minutes', i.duration_minutes,
            'mode', i.interview_mode, 'video_url', i.video_url,
            'location', i.location,
            'response', i.applicant_response,
            'reschedule_note', i.reschedule_note,
            'provider', (SELECT jsonb_build_object('domain', pe.provider_domain,
                'display_name', pe.provider_display_name)
             FROM vetchium.org_engagements AS pe
             WHERE pe.engagement_id = i.performer_engagement_id)
        ) ORDER BY i.starts_at, i.interview_number)
        FROM vetchium.org_interviews AS i
        WHERE i.org_application_id = a.org_application_id
          AND i.interview_state IN ('scheduled', 'cancelled')
    ), '[]'::jsonb)::jsonb AS interviews
FROM vetchium.org_domains AS d
JOIN vetchium.orgs AS org ON org.org_did = d.org_did
JOIN vetchium.org_openings AS o ON o.org_did = d.org_did
JOIN vetchium.org_applications AS a ON a.org_opening_id = o.org_opening_id
JOIN vetchium.org_applicants AS applicant
    ON applicant.org_applicant_id = a.org_applicant_id
JOIN vetchium.org_opening_contents AS c
    ON c.org_opening_id = o.org_opening_id AND c.slot = 'live'
LEFT JOIN vetchium.org_opening_stages AS stage
    ON stage.org_opening_stage_id = a.current_stage_id
LEFT JOIN LATERAL (
    SELECT f.offer_number, f.offer_status, f.letter_object_id,
        l.byte_size AS letter_byte_size, f.proposed_joining_date,
        f.respond_by, f.extended_at
    FROM vetchium.org_application_offers AS f
    JOIN vetchium.org_offer_letter_objects AS l
        ON l.object_id = f.letter_object_id
    WHERE f.org_application_id = a.org_application_id
    ORDER BY f.offer_number DESC
    LIMIT 1
) AS offer ON offer.offer_status <> 'withdrawn'
WHERE d.domain = sqlc.arg(domain)
  AND d.domain_state IN ('verified', 'failing', 'releasing')
  AND a.removed_at IS NULL
  AND o.opening_number = sqlc.arg(opening_number)::integer
  AND a.application_number = sqlc.arg(application_number)::integer
  AND applicant.hub_user_did = sqlc.arg(hub_user_did);

-- The Org this tenant homes for a Hub-facing domain, whatever its state:
-- the Org's tenant decides what a suspended Org still allows.
-- name: GetLocalOrgForDomain :one
SELECT d.org_did
FROM vetchium.org_domains AS d
WHERE d.domain = sqlc.arg(domain)
  AND d.domain_state IN ('verified', 'failing', 'releasing');

-- Records when the next unanswered interview starts, which is when the Hub
-- projection's interview_response action stops being true (HP-HUB-007). It
-- changes neither the version nor the update time, so it never conflicts with
-- an Org user's write; call it beside the audited change that enqueued the
-- projection event.
-- name: SetHubApplicationRefreshTimes :exec
UPDATE vetchium.org_applications AS a
SET hub_refresh_at = (
    SELECT min(i.starts_at)
    FROM vetchium.org_interviews AS i
    WHERE i.org_application_id = a.org_application_id
      AND i.interview_state = 'scheduled' AND i.starts_at > now()
      AND i.applicant_response = 'pending'
)
WHERE a.org_application_id = ANY(sqlc.arg(application_ids)::uuid[]);

-- Finds an active sourcing engagement of an agency with the given primary
-- domain assigned whole to the Opening (MKT-SRC-003).
-- name: GetAssignedSourcingEngagementForDomain :one
SELECT e.engagement_id, e.provider_domain, e.provider_display_name
FROM vetchium.org_engagements AS e
JOIN vetchium.org_engagement_assignments AS a
  ON a.engagement_id = e.engagement_id
WHERE a.org_opening_id = sqlc.arg(org_opening_id)
  AND a.org_opening_stage_id IS NULL
  AND e.capability_oid = 'sourcing'
  AND e.engagement_state = 'active'
  AND e.provider_domain = sqlc.arg(provider_domain);
