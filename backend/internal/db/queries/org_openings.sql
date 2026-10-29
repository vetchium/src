-- The read predicate is part of the query so a removed grant takes effect
-- before an Opening can be returned, including on a stale session.
-- name: GetOrgOpening :one
WITH visible AS (
    SELECT o.*
    FROM vetchium.org_openings AS o
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.opening_number = sqlc.arg(opening_number)
      AND (
          EXISTS (
              SELECT 1 FROM vetchium.org_effective_permissions AS ep
              WHERE ep.org_user_id = sqlc.arg(viewer_id)
                AND ep.permission = 'org:view_openings'
          )
          OR o.hiring_manager_id = sqlc.arg(viewer_id)
          OR o.recruiter_id = sqlc.arg(viewer_id)
          OR EXISTS (
              SELECT 1 FROM vetchium.org_opening_team_members AS tm
              WHERE tm.org_opening_id = o.org_opening_id
                AND tm.org_user_id = sqlc.arg(viewer_id)
          )
          OR (sqlc.arg(include_requester)::boolean AND EXISTS (
              SELECT 1 FROM vetchium.org_opening_requests AS r
              WHERE r.org_opening_id = o.org_opening_id
                AND r.requested_by = sqlc.arg(viewer_id)
                AND (r.request_state = 'pending'
                    OR (r.request_state = 'withdrawn'
                        AND r.decided_by = sqlc.arg(viewer_id)))
          ))
      )
)
SELECT jsonb_strip_nulls(jsonb_build_object(
    'opening_number', o.opening_number,
    'state', o.opening_state,
    'version', o.version,
    'revision', o.revision,
    'live_content', live.body,
    'working_content', working.body,
    'pending_request', pending.body,
    'hiring_manager', CASE WHEN manager.org_user_id IS NULL THEN NULL
        ELSE jsonb_build_object('email', manager.email_address,
            'active', manager.org_user_state = 'active') END,
    'recruiter', CASE WHEN recruiter.org_user_id IS NULL THEN NULL
        ELSE jsonb_build_object('email', recruiter.email_address,
            'active', recruiter.org_user_state = 'active') END,
    'team_members', COALESCE(team.body, '[]'::jsonb),
    'internal_notes', o.internal_notes,
    'created_by_email', creator.email_address,
    'created_at', o.created_at,
    'updated_at', o.updated_at,
    'first_published_at', o.first_published_at,
    'expires_at', o.expires_at,
    'last_revised_at', o.last_revised_at,
    'ended_at', o.ended_at
)) AS body
FROM visible AS o
JOIN vetchium.org_users AS creator ON creator.org_user_id = o.created_by
LEFT JOIN vetchium.org_users AS manager
    ON manager.org_user_id = o.hiring_manager_id
LEFT JOIN vetchium.org_users AS recruiter
    ON recruiter.org_user_id = o.recruiter_id
LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
        'email', u.email_address, 'active', u.org_user_state = 'active'
    ) ORDER BY u.email_address) AS body
    FROM vetchium.org_opening_team_members AS tm
    JOIN vetchium.org_users AS u ON u.org_user_id = tm.org_user_id
    WHERE tm.org_opening_id = o.org_opening_id
) AS team ON true
LEFT JOIN LATERAL (
    SELECT jsonb_strip_nulls(jsonb_build_object(
        'kind', r.request_kind,
        'requested_by_email', u.email_address,
        'requested_at', r.requested_at,
        'note', r.request_note,
        'mark_applications_not_progressing', CASE
            WHEN r.request_kind = 'close'
            THEN r.mark_applications_not_progressing END
    )) AS body
    FROM vetchium.org_opening_requests AS r
    JOIN vetchium.org_users AS u ON u.org_user_id = r.requested_by
    WHERE r.org_opening_id = o.org_opening_id
      AND r.request_state = 'pending'
) AS pending ON true
LEFT JOIN LATERAL (
    SELECT jsonb_strip_nulls(jsonb_build_object(
        'title', c.title,
        'description', c.description,
        'language', c.language,
        'employing_country', c.employing_country,
        'work_arrangement', c.work_arrangement,
        'location_details', c.location_details,
        'remote_eligibility', CASE WHEN c.remote_eligibility IS NULL THEN NULL
            ELSE jsonb_strip_nulls(jsonb_build_object(
                'kind', c.remote_eligibility,
                'countries', c.remote_countries)) END,
        'employment_type', c.employment_type,
        'positions', c.positions,
        'experience_years', CASE WHEN c.experience_min IS NULL
            AND c.experience_max IS NULL THEN NULL
            ELSE jsonb_strip_nulls(jsonb_build_object(
                'min', c.experience_min, 'max', c.experience_max)) END,
        'minimum_education', c.minimum_education,
        'salary', CASE WHEN c.salary_currency IS NULL THEN NULL
            ELSE jsonb_build_object('currency', c.salary_currency,
                'min', c.salary_min, 'max', c.salary_max,
                'period', c.salary_period) END,
        'questions', c.questions
    )) AS body
    FROM vetchium.org_opening_contents AS c
    WHERE c.org_opening_id = o.org_opening_id AND c.slot = 'live'
) AS live ON true
LEFT JOIN LATERAL (
    SELECT jsonb_strip_nulls(jsonb_build_object(
        'title', c.title,
        'description', c.description,
        'language', c.language,
        'employing_country', c.employing_country,
        'work_arrangement', c.work_arrangement,
        'location_details', c.location_details,
        'remote_eligibility', CASE WHEN c.remote_eligibility IS NULL THEN NULL
            ELSE jsonb_strip_nulls(jsonb_build_object(
                'kind', c.remote_eligibility,
                'countries', c.remote_countries)) END,
        'employment_type', c.employment_type,
        'positions', c.positions,
        'experience_years', CASE WHEN c.experience_min IS NULL
            AND c.experience_max IS NULL THEN NULL
            ELSE jsonb_strip_nulls(jsonb_build_object(
                'min', c.experience_min, 'max', c.experience_max)) END,
        'minimum_education', c.minimum_education,
        'salary', CASE WHEN c.salary_currency IS NULL THEN NULL
            ELSE jsonb_build_object('currency', c.salary_currency,
                'min', c.salary_min, 'max', c.salary_max,
                'period', c.salary_period) END,
        'questions', c.questions
    )) AS body
    FROM vetchium.org_opening_contents AS c
    WHERE c.org_opening_id = o.org_opening_id AND c.slot = 'working'
) AS working ON true;

-- name: ListOrgOpenings :many
SELECT
    o.opening_number,
    o.opening_state,
    c.title,
    c.employing_country,
    c.work_arrangement,
    c.employment_type,
    manager.email_address AS hiring_manager_email,
    recruiter.email_address AS recruiter_email,
    pending.request_kind AS pending_request_kind,
    o.updated_at,
    o.expires_at
FROM vetchium.org_openings AS o
LEFT JOIN vetchium.org_opening_contents AS c
    ON c.org_opening_id = o.org_opening_id
    AND c.slot = CASE WHEN o.opening_state = 'draft' THEN 'working'
        ELSE 'live' END::vetchium.org_opening_content_slot
LEFT JOIN vetchium.org_users AS manager
    ON manager.org_user_id = o.hiring_manager_id
LEFT JOIN vetchium.org_users AS recruiter
    ON recruiter.org_user_id = o.recruiter_id
LEFT JOIN vetchium.org_opening_requests AS pending
    ON pending.org_opening_id = o.org_opening_id
    AND pending.request_state = 'pending'
WHERE o.org_did = sqlc.arg(org_did)
  AND (
      EXISTS (
          SELECT 1 FROM vetchium.org_effective_permissions AS ep
          WHERE ep.org_user_id = sqlc.arg(viewer_id)
            AND ep.permission = 'org:view_openings'
      )
      OR o.hiring_manager_id = sqlc.arg(viewer_id)
      OR o.recruiter_id = sqlc.arg(viewer_id)
      OR EXISTS (
          SELECT 1 FROM vetchium.org_opening_team_members AS tm
          WHERE tm.org_opening_id = o.org_opening_id
            AND tm.org_user_id = sqlc.arg(viewer_id)
      )
  )
  AND ((sqlc.narg(states)::text[] IS NOT NULL
      AND o.opening_state::text = ANY(sqlc.narg(states)::text[]))
      OR (sqlc.narg(states)::text[] IS NULL
      AND o.opening_state <> 'discarded'))
  AND (sqlc.narg(pending_request_kinds)::text[] IS NULL
      OR pending.request_kind::text = ANY(sqlc.narg(pending_request_kinds)::text[]))
  AND (NOT sqlc.arg(awaiting_my_approval)::boolean
      OR (pending.org_opening_request_id IS NOT NULL
          AND EXISTS (
              SELECT 1 FROM vetchium.org_effective_permissions AS ep
              WHERE ep.org_user_id = sqlc.arg(viewer_id)
                AND ep.permission = 'org:approve_openings'
          )))
  AND (sqlc.narg(hiring_manager_email)::text IS NULL
      OR manager.email_address = sqlc.narg(hiring_manager_email)::text)
  AND (sqlc.narg(recruiter_email)::text IS NULL
      OR recruiter.email_address = sqlc.narg(recruiter_email)::text)
  AND (sqlc.narg(employing_country)::text IS NULL
      OR c.employing_country = sqlc.narg(employing_country)::text)
  AND (sqlc.narg(work_arrangement)::text IS NULL
      OR c.work_arrangement::text = sqlc.narg(work_arrangement)::text)
  AND (sqlc.narg(employment_type)::text IS NULL
      OR c.employment_type::text = sqlc.narg(employment_type)::text)
  AND (sqlc.narg(title_query)::text IS NULL
      OR strpos(lower(c.title), lower(sqlc.narg(title_query)::text)) > 0)
  AND (sqlc.narg(after_updated_at)::timestamptz IS NULL
      OR (o.updated_at, o.opening_number) <
          (sqlc.narg(after_updated_at)::timestamptz,
           sqlc.narg(after_opening_number)::integer))
ORDER BY o.updated_at DESC, o.opening_number DESC
LIMIT sqlc.arg(page_limit);

-- Lock separately: after a concurrent creator releases it, the next
-- statement sees the newly committed quota count and counter.
-- name: LockOrgOpeningPolicy :one
SELECT o.org_plan_oid, o.next_opening_number, o.country, o.default_language
FROM vetchium.orgs AS o
WHERE o.org_did = sqlc.arg(org_did) AND o.org_state = 'active'
FOR UPDATE;

-- name: CreateOrgOpening :one
WITH usage AS (
    SELECT count(*)::integer AS used
    FROM vetchium.org_openings AS existing
    WHERE existing.org_did = sqlc.arg(org_did)
      AND existing.created_at > sqlc.arg(window_start)::timestamptz
), wanted AS (
    SELECT DISTINCT email_address
    FROM unnest(
        ARRAY[sqlc.narg(hiring_manager_email)::text,
              sqlc.narg(recruiter_email)::text]
        || sqlc.arg(team_member_emails)::text[]
    ) AS names(email_address)
    WHERE email_address IS NOT NULL
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
), template_missing AS (
    SELECT sqlc.narg(template_id)::uuid IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM vetchium.org_pipeline_templates AS t
        WHERE t.org_did = sqlc.arg(org_did)
          AND t.org_pipeline_template_id = sqlc.narg(template_id)::uuid
    ) AS missing
), stage_source AS (
    SELECT s.position::integer AS position, s.name, s.stage_kind
    FROM vetchium.org_pipeline_template_stages AS s
    JOIN vetchium.org_pipeline_templates AS t
        ON t.org_pipeline_template_id = s.org_pipeline_template_id
    WHERE t.org_did = sqlc.arg(org_did)
      AND t.org_pipeline_template_id = sqlc.narg(template_id)::uuid
    UNION ALL
    SELECT 1, 'Review', 'review'::vetchium.pipeline_stage_kind
    WHERE sqlc.narg(template_id)::uuid IS NULL
), numbered AS (
    UPDATE vetchium.orgs AS o
    SET next_opening_number = o.next_opening_number + 1
    FROM usage, invalid, template_missing
    WHERE o.org_did = sqlc.arg(org_did)
      AND usage.used < sqlc.arg(quota)::integer
      AND cardinality(invalid.addresses) = 0
      AND NOT template_missing.missing
    RETURNING o.next_opening_number - 1 AS opening_number
), created AS (
    INSERT INTO vetchium.org_openings (
        org_opening_id, org_did, opening_number, hiring_manager_id,
        recruiter_id, internal_notes, created_by
    )
    SELECT sqlc.arg(opening_id), sqlc.arg(org_did), numbered.opening_number,
        (SELECT org_user_id FROM resolved
         WHERE email_address = sqlc.narg(hiring_manager_email)::text),
        (SELECT org_user_id FROM resolved
         WHERE email_address = sqlc.narg(recruiter_email)::text),
        sqlc.narg(internal_notes)::text, sqlc.arg(actor_id)
    FROM numbered
    RETURNING org_opening_id, opening_number, version
), content AS (
    INSERT INTO vetchium.org_opening_contents (
        org_opening_id, slot, title, description, language,
        employing_country, work_arrangement, location_details,
        remote_eligibility, remote_countries, employment_type,
        positions, experience_min, experience_max, minimum_education,
        salary_currency, salary_min, salary_max, salary_period, questions,
        updated_by
    )
    SELECT created.org_opening_id, 'working',
        body->>'title', body->>'description', body->>'language',
        body->>'employing_country',
        (body->>'work_arrangement')::vetchium.org_opening_work_arrangement,
        body->>'location_details',
        (body #>> '{remote_eligibility,kind}')::
            vetchium.org_opening_remote_eligibility,
        CASE WHEN body #> '{remote_eligibility,countries}' IS NULL
            THEN NULL ELSE ARRAY(
                SELECT jsonb_array_elements_text(
                    body #> '{remote_eligibility,countries}')
            ) END,
        (body->>'employment_type')::vetchium.org_opening_employment_type,
        (body->>'positions')::integer,
        (body #>> '{experience_years,min}')::integer,
        (body #>> '{experience_years,max}')::integer,
        (body->>'minimum_education')::vetchium.org_opening_education,
        body #>> '{salary,currency}',
        (body #>> '{salary,min}')::bigint,
        (body #>> '{salary,max}')::bigint,
        (body #>> '{salary,period}')::vetchium.org_opening_salary_period,
        NULLIF(body->'questions', '[]'::jsonb),
        sqlc.arg(actor_id)
    FROM created
    CROSS JOIN (SELECT sqlc.arg(content)::jsonb AS body) AS input
    RETURNING org_opening_id
), stages AS (
    INSERT INTO vetchium.org_opening_stages (
        org_opening_stage_id, org_opening_id, position, name, stage_kind
    )
    SELECT (sqlc.arg(stage_ids)::uuid[])[stage_source.position],
        created.org_opening_id, stage_source.position, stage_source.name,
        stage_source.stage_kind
    FROM created CROSS JOIN stage_source
    RETURNING org_opening_stage_id
), team AS (
    INSERT INTO vetchium.org_opening_team_members (
        org_opening_id, org_user_id
    )
    SELECT created.org_opening_id, resolved.org_user_id
    FROM created
    JOIN resolved ON resolved.email_address =
        ANY(sqlc.arg(team_member_emails)::text[])
    RETURNING org_opening_id
), history AS (
    INSERT INTO vetchium.org_opening_history (
        org_opening_history_id, org_opening_id, action,
        actor_org_user_id, opening_version
    )
    SELECT sqlc.arg(history_id), created.org_opening_id,
        'created', sqlc.arg(actor_id), created.version
    FROM created
    RETURNING org_opening_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.opening.created', 'org_opening',
        sqlc.arg(org_did)::text || ':' || created.opening_number::text,
        'org_user', sqlc.arg(actor_id)::text, 'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('opening_number', created.opening_number,
            'action', 'created', 'version', created.version,
            'changed_fields', jsonb_build_array('content', 'hiring_team',
                'internal_notes', 'pipeline'))
    FROM created
    RETURNING audit_event_id
)
SELECT usage.used,
    to_jsonb(invalid.addresses) AS invalid_addresses,
    COALESCE(template_missing.missing, false)::boolean AS template_missing,
    COALESCE((SELECT opening_number FROM created), 0)::integer AS opening_number,
    (SELECT count(*) FROM content) AS content_rows,
    (SELECT count(*) FROM stages) AS stage_rows,
    (SELECT count(*) FROM team) AS team_rows,
    (SELECT count(*) FROM history) AS history_rows,
    (SELECT count(*) FROM audit) AS audit_rows
FROM usage CROSS JOIN invalid CROSS JOIN template_missing;

-- name: DuplicateOrgOpening :one
WITH source AS (
    SELECT o.org_opening_id, o.org_did, o.opening_number,
        o.opening_state, o.hiring_manager_id, o.recruiter_id,
        o.internal_notes
    FROM vetchium.org_openings AS o
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.opening_number = sqlc.arg(duplicate_number)::integer
), source_content AS (
    SELECT c.*
    FROM vetchium.org_opening_contents AS c
    JOIN source ON source.org_opening_id = c.org_opening_id
    ORDER BY (c.slot = 'working') DESC
    LIMIT 1
), usage AS (
    SELECT count(*)::integer AS used
    FROM vetchium.org_openings AS existing
    WHERE existing.org_did = sqlc.arg(org_did)
      AND existing.created_at > sqlc.arg(window_start)::timestamptz
), template_missing AS (
    SELECT sqlc.narg(template_id)::uuid IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM vetchium.org_pipeline_templates AS t
        WHERE t.org_did = sqlc.arg(org_did)
          AND t.org_pipeline_template_id = sqlc.narg(template_id)::uuid
    ) AS missing
), source_stages AS (
    SELECT s.position::integer AS position, s.name, s.stage_kind
    FROM vetchium.org_opening_stages AS s
    JOIN source ON source.org_opening_id = s.org_opening_id
), stage_source AS (
    SELECT s.position::integer AS position, s.name, s.stage_kind
    FROM vetchium.org_pipeline_template_stages AS s
    JOIN vetchium.org_pipeline_templates AS t
        ON t.org_pipeline_template_id = s.org_pipeline_template_id
    WHERE t.org_did = sqlc.arg(org_did)
      AND t.org_pipeline_template_id = sqlc.narg(template_id)::uuid
    UNION ALL
    SELECT position, name, stage_kind FROM source_stages
    WHERE sqlc.narg(template_id)::uuid IS NULL
    UNION ALL
    SELECT 1, 'Review', 'review'::vetchium.pipeline_stage_kind
    WHERE sqlc.narg(template_id)::uuid IS NULL
      AND NOT EXISTS (SELECT 1 FROM source_stages)
), numbered AS (
    UPDATE vetchium.orgs AS o
    SET next_opening_number = o.next_opening_number + 1
    FROM usage, source, template_missing
    WHERE o.org_did = sqlc.arg(org_did)
      AND source.opening_state <> 'discarded'
      AND EXISTS (SELECT 1 FROM source_content)
      AND NOT template_missing.missing
      AND usage.used < sqlc.arg(quota)::integer
    RETURNING o.next_opening_number - 1 AS opening_number
), created AS (
    INSERT INTO vetchium.org_openings (
        org_opening_id, org_did, opening_number, hiring_manager_id,
        recruiter_id, internal_notes, created_by
    )
    SELECT sqlc.arg(opening_id), sqlc.arg(org_did), numbered.opening_number,
        CASE WHEN manager.org_user_state = 'active'
            THEN manager.org_user_id ELSE NULL END,
        CASE WHEN recruiter.org_user_state = 'active'
            THEN recruiter.org_user_id ELSE NULL END,
        source.internal_notes, sqlc.arg(actor_id)
    FROM numbered CROSS JOIN source
    LEFT JOIN vetchium.org_users AS manager
        ON manager.org_user_id = source.hiring_manager_id
    LEFT JOIN vetchium.org_users AS recruiter
        ON recruiter.org_user_id = source.recruiter_id
    RETURNING org_opening_id, opening_number, version
), content AS (
    INSERT INTO vetchium.org_opening_contents (
        org_opening_id, slot, title, description, language,
        employing_country, work_arrangement, location_details,
        remote_eligibility, remote_countries, employment_type,
        positions, experience_min, experience_max, minimum_education,
        salary_currency, salary_min, salary_max, salary_period, questions,
        updated_by
    )
    SELECT created.org_opening_id, 'working', source_content.title,
        source_content.description, source_content.language,
        source_content.employing_country, source_content.work_arrangement,
        source_content.location_details, source_content.remote_eligibility,
        source_content.remote_countries, source_content.employment_type,
        source_content.positions, source_content.experience_min,
        source_content.experience_max, source_content.minimum_education,
        source_content.salary_currency, source_content.salary_min,
        source_content.salary_max, source_content.salary_period,
        source_content.questions, sqlc.arg(actor_id)
    FROM created CROSS JOIN source_content
    RETURNING org_opening_id
), stages AS (
    INSERT INTO vetchium.org_opening_stages (
        org_opening_stage_id, org_opening_id, position, name, stage_kind
    )
    SELECT (sqlc.arg(stage_ids)::uuid[])[stage_source.position],
        created.org_opening_id, stage_source.position, stage_source.name,
        stage_source.stage_kind
    FROM created CROSS JOIN stage_source
    RETURNING org_opening_stage_id
), team AS (
    INSERT INTO vetchium.org_opening_team_members (
        org_opening_id, org_user_id
    )
    SELECT created.org_opening_id, u.org_user_id
    FROM created CROSS JOIN source
    JOIN vetchium.org_opening_team_members AS tm
        ON tm.org_opening_id = source.org_opening_id
    JOIN vetchium.org_users AS u ON u.org_user_id = tm.org_user_id
        AND u.org_user_state = 'active'
    RETURNING org_opening_id
), history AS (
    INSERT INTO vetchium.org_opening_history (
        org_opening_history_id, org_opening_id, action,
        actor_org_user_id, opening_version, source_opening_number
    )
    SELECT sqlc.arg(history_id), created.org_opening_id,
        'duplicated', sqlc.arg(actor_id), created.version,
        sqlc.arg(duplicate_number)
    FROM created
    RETURNING org_opening_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.opening.duplicated', 'org_opening',
        sqlc.arg(org_did)::text || ':' || created.opening_number::text,
        'org_user', sqlc.arg(actor_id)::text, 'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('opening_number', created.opening_number,
            'source_opening_number', sqlc.arg(duplicate_number),
            'action', 'duplicated', 'version', created.version,
            'changed_fields', jsonb_build_array('content', 'hiring_team',
                'internal_notes', 'pipeline'))
    FROM created
    RETURNING audit_event_id
)
SELECT usage.used,
    COALESCE((SELECT opening_state::text FROM source), '')::text
        AS source_state,
    COALESCE(template_missing.missing, false)::boolean AS template_missing,
    COALESCE((SELECT opening_number FROM created), 0)::integer
        AS opening_number,
    (SELECT count(*) FROM content) AS content_rows,
    (SELECT count(*) FROM stages) AS stage_rows,
    (SELECT count(*) FROM history) AS history_rows,
    (SELECT count(*) FROM audit) AS audit_rows,
    (SELECT count(*) FROM team) AS team_rows
FROM usage CROSS JOIN template_missing;

-- Used only after a guarded write affects no row, to choose its problem.
-- name: GetOrgOpeningChangeState :one
SELECT o.opening_state, o.version,
    EXISTS (
        SELECT 1 FROM vetchium.org_opening_requests AS r
        WHERE r.org_opening_id = o.org_opening_id
          AND r.request_state = 'pending'
    ) AS has_pending_request,
    EXISTS (
        SELECT 1 FROM vetchium.org_opening_requests AS r
        WHERE r.org_opening_id = o.org_opening_id
          AND r.request_state = 'pending'
          AND r.request_kind IN ('publish', 'revise')
    ) AS has_pending_content_request,
    EXISTS (
        SELECT 1 FROM vetchium.org_opening_contents AS c
        WHERE c.org_opening_id = o.org_opening_id AND c.slot = 'working'
    ) AS has_working_content
FROM vetchium.org_openings AS o
WHERE o.org_did = sqlc.arg(org_did)
  AND o.opening_number = sqlc.arg(opening_number)::integer;

-- name: SaveOrgOpeningWorkingCopy :one
WITH input AS (
    SELECT sqlc.arg(content)::jsonb AS body
), flat AS (
    SELECT body->>'title' AS title,
        body->>'description' AS description,
        body->>'language' AS language,
        body->>'employing_country' AS employing_country,
        (body->>'work_arrangement')::
            vetchium.org_opening_work_arrangement AS work_arrangement,
        body->>'location_details' AS location_details,
        (body #>> '{remote_eligibility,kind}')::
            vetchium.org_opening_remote_eligibility AS remote_eligibility,
        CASE WHEN body #> '{remote_eligibility,countries}' IS NULL
            THEN NULL ELSE ARRAY(
                SELECT jsonb_array_elements_text(
                    body #> '{remote_eligibility,countries}')
            ) END AS remote_countries,
        (body->>'employment_type')::
            vetchium.org_opening_employment_type AS employment_type,
        (body->>'positions')::integer AS positions,
        (body #>> '{experience_years,min}')::integer AS experience_min,
        (body #>> '{experience_years,max}')::integer AS experience_max,
        (body->>'minimum_education')::
            vetchium.org_opening_education AS minimum_education,
        body #>> '{salary,currency}' AS salary_currency,
        (body #>> '{salary,min}')::bigint AS salary_min,
        (body #>> '{salary,max}')::bigint AS salary_max,
        (body #>> '{salary,period}')::
            vetchium.org_opening_salary_period AS salary_period,
        NULLIF(body->'questions', '[]'::jsonb) AS questions
    FROM input
), known_questions AS (
    SELECT question->>'id' AS question_id
    FROM vetchium.org_openings AS o
    JOIN vetchium.org_opening_contents AS c
      ON c.org_opening_id = o.org_opening_id
    CROSS JOIN LATERAL jsonb_array_elements(c.questions) AS question
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.opening_number = sqlc.arg(opening_number)::integer
      AND c.questions IS NOT NULL
), unknown_questions AS (
    -- A question id the caller sent must name one the Opening already asks or
    -- will ask (HP-QST-002); new_question_ids are the ones orgs-api just
    -- assigned. Positions are 1-based.
    SELECT entry.position::integer AS position
    FROM input
    CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(input.body->'questions', '[]'::jsonb))
        WITH ORDINALITY AS entry(question, position)
    WHERE entry.question ? 'id'
      AND NOT entry.question->>'id' = ANY(
          sqlc.arg(new_question_ids)::text[])
      AND NOT EXISTS (
          SELECT 1 FROM known_questions AS k
          WHERE k.question_id = entry.question->>'id'
      )
), updated AS (
    UPDATE vetchium.org_openings AS o
    SET version = o.version + 1, updated_at = now()
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.opening_number = sqlc.arg(opening_number)::integer
      AND o.version = sqlc.arg(version)::integer
      AND o.opening_state IN ('draft', 'published', 'paused')
      AND NOT EXISTS (SELECT 1 FROM unknown_questions)
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_opening_requests AS r
          WHERE r.org_opening_id = o.org_opening_id
            AND r.request_state = 'pending'
            AND r.request_kind IN ('publish', 'revise')
      )
    RETURNING o.org_opening_id, o.opening_number, o.version
), saved AS (
    INSERT INTO vetchium.org_opening_contents (
        org_opening_id, slot, title, description, language,
        employing_country, work_arrangement, location_details,
        remote_eligibility, remote_countries, employment_type,
        positions, experience_min, experience_max, minimum_education,
        salary_currency, salary_min, salary_max, salary_period, questions,
        updated_by, updated_at
    )
    SELECT updated.org_opening_id, 'working',
        flat.title, flat.description, flat.language,
        flat.employing_country, flat.work_arrangement, flat.location_details,
        flat.remote_eligibility, flat.remote_countries, flat.employment_type,
        flat.positions, flat.experience_min, flat.experience_max,
        flat.minimum_education, flat.salary_currency, flat.salary_min,
        flat.salary_max, flat.salary_period, flat.questions,
        sqlc.arg(actor_id), now()
    FROM updated CROSS JOIN flat
    ON CONFLICT (org_opening_id, slot) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        language = EXCLUDED.language,
        employing_country = EXCLUDED.employing_country,
        work_arrangement = EXCLUDED.work_arrangement,
        location_details = EXCLUDED.location_details,
        remote_eligibility = EXCLUDED.remote_eligibility,
        remote_countries = EXCLUDED.remote_countries,
        employment_type = EXCLUDED.employment_type,
        positions = EXCLUDED.positions,
        experience_min = EXCLUDED.experience_min,
        experience_max = EXCLUDED.experience_max,
        minimum_education = EXCLUDED.minimum_education,
        salary_currency = EXCLUDED.salary_currency,
        salary_min = EXCLUDED.salary_min,
        salary_max = EXCLUDED.salary_max,
        salary_period = EXCLUDED.salary_period,
        questions = EXCLUDED.questions,
        updated_by = EXCLUDED.updated_by,
        updated_at = EXCLUDED.updated_at
    RETURNING org_opening_id
), history AS (
    INSERT INTO vetchium.org_opening_history (
        org_opening_history_id, org_opening_id, action,
        actor_org_user_id, opening_version
    )
    SELECT sqlc.arg(history_id), updated.org_opening_id,
        'working_copy_saved', sqlc.arg(actor_id), updated.version
    FROM updated
    RETURNING org_opening_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.opening.working-copy-saved',
        'org_opening', sqlc.arg(org_did)::text || ':' ||
        updated.opening_number::text, 'org_user',
        sqlc.arg(actor_id)::text, 'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('opening_number', updated.opening_number,
            'action', 'working_copy_saved', 'version', updated.version,
            'changed_fields', jsonb_build_array('content'))
    FROM updated
    RETURNING audit_event_id
)
SELECT COALESCE((SELECT version FROM updated), 0)::integer AS version,
    COALESCE((SELECT jsonb_agg(position ORDER BY position)
        FROM unknown_questions), '[]'::jsonb)::jsonb
        AS unknown_question_positions,
    (SELECT count(*) FROM saved) AS saved_rows,
    (SELECT count(*) FROM history) AS history_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- name: DiscardOrgOpeningWorkingCopy :one
WITH updated AS (
    UPDATE vetchium.org_openings AS o
    SET version = o.version + 1, updated_at = now()
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.opening_number = sqlc.arg(opening_number)::integer
      AND o.version = sqlc.arg(version)::integer
      AND o.opening_state IN ('published', 'paused')
      AND EXISTS (
          SELECT 1 FROM vetchium.org_opening_contents AS c
          WHERE c.org_opening_id = o.org_opening_id AND c.slot = 'working'
      )
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_opening_requests AS r
          WHERE r.org_opening_id = o.org_opening_id
            AND r.request_state = 'pending' AND r.request_kind = 'revise'
      )
    RETURNING o.org_opening_id, o.opening_number, o.version
), removed AS (
    DELETE FROM vetchium.org_opening_contents AS c
    USING updated
    WHERE c.org_opening_id = updated.org_opening_id AND c.slot = 'working'
    RETURNING c.org_opening_id
), history AS (
    INSERT INTO vetchium.org_opening_history (
        org_opening_history_id, org_opening_id, action,
        actor_org_user_id, opening_version
    )
    SELECT sqlc.arg(history_id), updated.org_opening_id,
        'revision_discarded', sqlc.arg(actor_id), updated.version
    FROM updated
    RETURNING org_opening_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.opening.revision-discarded',
        'org_opening', sqlc.arg(org_did)::text || ':' ||
        updated.opening_number::text, 'org_user',
        sqlc.arg(actor_id)::text, 'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('opening_number', updated.opening_number,
            'action', 'revision_discarded', 'version', updated.version,
            'changed_fields', jsonb_build_array('working_content'))
    FROM updated
    RETURNING audit_event_id
)
SELECT COALESCE((SELECT version FROM updated), 0)::integer AS version,
    (SELECT count(*) FROM removed) AS removed_rows,
    (SELECT count(*) FROM history) AS history_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- name: DiscardOrgOpening :one
WITH updated AS (
    UPDATE vetchium.org_openings AS o
    SET opening_state = 'discarded', version = o.version + 1,
        updated_at = now(), ended_at = now(), internal_notes = NULL,
        hiring_manager_id = NULL, recruiter_id = NULL
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.opening_number = sqlc.arg(opening_number)::integer
      AND o.version = sqlc.arg(version)::integer
      AND o.opening_state = 'draft'
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_opening_requests AS r
          WHERE r.org_opening_id = o.org_opening_id AND r.request_state = 'pending'
      )
    RETURNING o.org_opening_id, o.opening_number, o.version
), removed_content AS (
    DELETE FROM vetchium.org_opening_contents AS c
    USING updated
    WHERE c.org_opening_id = updated.org_opening_id
    RETURNING c.org_opening_id
), removed_team AS (
    DELETE FROM vetchium.org_opening_team_members AS tm
    USING updated
    WHERE tm.org_opening_id = updated.org_opening_id
    RETURNING tm.org_opening_id
), removed_stages AS (
    DELETE FROM vetchium.org_opening_stages AS s
    USING updated
    WHERE s.org_opening_id = updated.org_opening_id
    RETURNING s.org_opening_stage_id
), history AS (
    INSERT INTO vetchium.org_opening_history (
        org_opening_history_id, org_opening_id, action,
        actor_org_user_id, opening_version
    )
    SELECT sqlc.arg(history_id), updated.org_opening_id,
        'discarded', sqlc.arg(actor_id), updated.version
    FROM updated
    RETURNING org_opening_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.opening.discarded',
        'org_opening', sqlc.arg(org_did)::text || ':' ||
        updated.opening_number::text, 'org_user',
        sqlc.arg(actor_id)::text, 'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('opening_number', updated.opening_number,
            'action', 'discarded', 'version', updated.version,
            'changed_fields', jsonb_build_array('state', 'working_content',
                'team', 'internal_notes', 'pipeline'))
    FROM updated
    RETURNING audit_event_id
)
SELECT COALESCE((SELECT version FROM updated), 0)::integer AS version,
    (SELECT count(*) FROM history) AS history_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- name: SetOrgOpeningTeam :one
WITH wanted AS (
    SELECT DISTINCT email_address
    FROM unnest(
        ARRAY[sqlc.narg(hiring_manager_email)::text,
              sqlc.narg(recruiter_email)::text]
        || sqlc.arg(team_member_emails)::text[]
    ) AS names(email_address)
    WHERE email_address IS NOT NULL
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
), updated AS (
    UPDATE vetchium.org_openings AS o
    SET hiring_manager_id = (SELECT org_user_id FROM resolved
        WHERE email_address = sqlc.narg(hiring_manager_email)::text),
        recruiter_id = (SELECT org_user_id FROM resolved
        WHERE email_address = sqlc.narg(recruiter_email)::text),
        internal_notes = sqlc.narg(internal_notes)::text,
        version = o.version + 1, updated_at = now()
    FROM invalid
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.opening_number = sqlc.arg(opening_number)::integer
      AND o.version = sqlc.arg(version)::integer
      AND o.opening_state IN ('draft', 'published', 'paused')
      AND cardinality(invalid.addresses) = 0
    RETURNING o.org_opening_id, o.opening_number, o.version
), removed AS (
    DELETE FROM vetchium.org_opening_team_members AS tm
    USING updated
    WHERE tm.org_opening_id = updated.org_opening_id
      AND tm.org_user_id NOT IN (
          SELECT org_user_id FROM resolved
          WHERE email_address = ANY(sqlc.arg(team_member_emails)::text[])
      )
    RETURNING tm.org_user_id
), added AS (
    INSERT INTO vetchium.org_opening_team_members (
        org_opening_id, org_user_id
    )
    SELECT updated.org_opening_id, resolved.org_user_id
    FROM updated JOIN resolved ON resolved.email_address =
        ANY(sqlc.arg(team_member_emails)::text[])
    ON CONFLICT DO NOTHING
    RETURNING org_user_id
), history AS (
    INSERT INTO vetchium.org_opening_history (
        org_opening_history_id, org_opening_id, action,
        actor_org_user_id, opening_version
    )
    SELECT sqlc.arg(history_id), updated.org_opening_id,
        'team_changed', sqlc.arg(actor_id), updated.version
    FROM updated
    RETURNING org_opening_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.opening.team-changed',
        'org_opening', sqlc.arg(org_did)::text || ':' ||
        updated.opening_number::text, 'org_user',
        sqlc.arg(actor_id)::text, 'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('opening_number', updated.opening_number,
            'action', 'team_changed', 'version', updated.version,
            'changed_fields', jsonb_build_array('hiring_team', 'internal_notes'))
    FROM updated
    RETURNING audit_event_id
)
SELECT to_jsonb(invalid.addresses) AS invalid_addresses,
    COALESCE((SELECT version FROM updated), 0)::integer AS version,
    (SELECT count(*) FROM history) AS history_rows,
    (SELECT count(*) FROM audit) AS audit_rows
FROM invalid;

-- name: GetOrgOpeningSummary :one
WITH visible AS (
    SELECT o.opening_state
    FROM vetchium.org_openings AS o
    WHERE o.org_did = sqlc.arg(org_did)
      AND (
          EXISTS (
              SELECT 1 FROM vetchium.org_effective_permissions AS ep
              WHERE ep.org_user_id = sqlc.arg(viewer_id)
                AND ep.permission = 'org:view_openings'
          )
          OR o.hiring_manager_id = sqlc.arg(viewer_id)
          OR o.recruiter_id = sqlc.arg(viewer_id)
          OR EXISTS (
              SELECT 1 FROM vetchium.org_opening_team_members AS tm
              WHERE tm.org_opening_id = o.org_opening_id
                AND tm.org_user_id = sqlc.arg(viewer_id)
          )
      )
), grouped AS (
    SELECT opening_state, count(*)::integer AS count FROM visible
    GROUP BY opening_state
)
SELECT
    o.org_plan_oid,
    (SELECT count(*)::integer FROM vetchium.org_openings AS created
     WHERE created.org_did = o.org_did
       AND created.created_at > sqlc.arg(window_start)::timestamptz) AS used,
    COALESCE(grouped_items.items, '[]'::jsonb) AS counts
FROM vetchium.orgs AS o
LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
        'state', opening_state, 'count', count) ORDER BY opening_state)
        AS items
    FROM grouped
) AS grouped_items ON true
WHERE o.org_did = sqlc.arg(org_did)
  AND (
      EXISTS (
          SELECT 1 FROM vetchium.org_effective_permissions AS ep
          WHERE ep.org_user_id = sqlc.arg(viewer_id)
            AND ep.permission = 'org:view_openings'
      )
      OR EXISTS (SELECT 1 FROM visible)
  );

-- name: LookupOpeningTeamMember :one
SELECT u.email_address
FROM vetchium.org_users AS u
WHERE u.org_did = sqlc.arg(org_did)
  AND u.email_address = sqlc.arg(email_address)
  AND u.org_user_state = 'active';

-- name: ListOrgOpeningHistory :many
WITH visible AS (
    SELECT o.org_opening_id
    FROM vetchium.org_openings AS o
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.opening_number = sqlc.arg(opening_number)
      AND (
          EXISTS (
              SELECT 1 FROM vetchium.org_effective_permissions AS ep
              WHERE ep.org_user_id = sqlc.arg(viewer_id)
                AND ep.permission = 'org:view_openings'
          )
          OR o.hiring_manager_id = sqlc.arg(viewer_id)
          OR o.recruiter_id = sqlc.arg(viewer_id)
          OR EXISTS (
              SELECT 1 FROM vetchium.org_opening_team_members AS tm
              WHERE tm.org_opening_id = o.org_opening_id
                AND tm.org_user_id = sqlc.arg(viewer_id)
          )
      )
)
SELECT
    h.org_opening_history_id,
    h.created_at,
    jsonb_strip_nulls(jsonb_build_object(
        'action', h.action,
        'actor_email', actor.email_address,
        'request_kind', h.request_kind,
        'request_state', h.request_state,
        'request_note', req.request_note,
        'decision_note', req.decision_note,
        'source_opening_number', h.source_opening_number,
        'version', h.opening_version,
        'created_at', h.created_at
    )) AS body
FROM vetchium.org_opening_history AS h
JOIN visible AS o ON o.org_opening_id = h.org_opening_id
LEFT JOIN vetchium.org_users AS actor
    ON actor.org_user_id = h.actor_org_user_id
LEFT JOIN vetchium.org_opening_requests AS req
    ON req.org_opening_request_id = h.org_opening_request_id
WHERE sqlc.narg(after_created_at)::timestamptz IS NULL
   OR (h.created_at, h.org_opening_history_id) <
      (sqlc.narg(after_created_at)::timestamptz,
       sqlc.narg(after_history_id)::uuid)
ORDER BY h.created_at DESC, h.org_opening_history_id DESC
LIMIT sqlc.arg(page_limit);
