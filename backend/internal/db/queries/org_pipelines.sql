-- Serializes template creation and renaming within an Org, so the count and
-- the name check in the next statement cannot race a sibling request.
-- name: LockOrgForPipelineTemplates :one
SELECT o.org_did
FROM vetchium.orgs AS o
WHERE o.org_did = sqlc.arg(org_did) AND o.org_state = 'active'
FOR UPDATE;

-- name: ListOrgPipelineTemplates :many
SELECT t.org_pipeline_template_id, t.name, lower(t.name)::text AS sort_name,
    t.created_at, t.updated_at,
    COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'name', s.name, 'kind', s.stage_kind
        ) ORDER BY s.position)
        FROM vetchium.org_pipeline_template_stages AS s
        WHERE s.org_pipeline_template_id = t.org_pipeline_template_id
    ), '[]'::jsonb)::jsonb AS stages
FROM vetchium.org_pipeline_templates AS t
WHERE t.org_did = sqlc.arg(org_did)
  AND (sqlc.narg(after_name)::text IS NULL
      OR (lower(t.name), t.org_pipeline_template_id) >
          (sqlc.narg(after_name)::text, sqlc.narg(after_id)::uuid))
ORDER BY lower(t.name), t.org_pipeline_template_id
LIMIT sqlc.arg(page_limit);

-- name: GetOrgPipelineTemplate :one
SELECT t.org_pipeline_template_id, t.name, t.created_at, t.updated_at,
    COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'name', s.name, 'kind', s.stage_kind
        ) ORDER BY s.position)
        FROM vetchium.org_pipeline_template_stages AS s
        WHERE s.org_pipeline_template_id = t.org_pipeline_template_id
    ), '[]'::jsonb)::jsonb AS stages
FROM vetchium.org_pipeline_templates AS t
WHERE t.org_did = sqlc.arg(org_did)
  AND t.org_pipeline_template_id = sqlc.arg(template_id);

-- A name collision is reported through name_taken, never as a unique-index
-- error: the caller holds the Org lock, so the check cannot race.
-- name: CreateOrgPipelineTemplate :one
WITH usage AS (
    SELECT count(*)::integer AS used
    FROM vetchium.org_pipeline_templates AS t
    WHERE t.org_did = sqlc.arg(org_did)
), taken AS (
    SELECT EXISTS (
        SELECT 1 FROM vetchium.org_pipeline_templates AS t
        WHERE t.org_did = sqlc.arg(org_did)
          AND lower(t.name) = lower(sqlc.arg(name)::text)
    ) AS name_taken
), created AS (
    INSERT INTO vetchium.org_pipeline_templates (
        org_pipeline_template_id, org_did, name
    )
    SELECT sqlc.arg(template_id), sqlc.arg(org_did), sqlc.arg(name)::text
    FROM usage CROSS JOIN taken
    WHERE usage.used < sqlc.arg(template_limit)::integer
      AND NOT taken.name_taken
    RETURNING org_pipeline_template_id
), stages AS (
    INSERT INTO vetchium.org_pipeline_template_stages (
        org_pipeline_template_id, position, name, stage_kind
    )
    SELECT created.org_pipeline_template_id, input.position::smallint,
        input.stage->>'name',
        (input.stage->>'kind')::vetchium.pipeline_stage_kind
    FROM created
    CROSS JOIN jsonb_array_elements(sqlc.arg(stages)::jsonb)
        WITH ORDINALITY AS input(stage, position)
    RETURNING position
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.pipeline-template.created',
        'org_pipeline_template', created.org_pipeline_template_id::text,
        'org_user', sqlc.arg(actor_id)::text, 'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('action', 'created',
            'stage_count', jsonb_array_length(sqlc.arg(stages)::jsonb),
            'changed_fields', jsonb_build_array('name', 'stages'))
    FROM created
    RETURNING audit_event_id
)
SELECT usage.used, taken.name_taken,
    (SELECT count(*) FROM created) AS created_rows,
    (SELECT count(*) FROM stages) AS stage_rows,
    (SELECT count(*) FROM audit) AS audit_rows
FROM usage CROSS JOIN taken;

-- name: UpdateOrgPipelineTemplate :one
WITH existing AS (
    SELECT t.org_pipeline_template_id
    FROM vetchium.org_pipeline_templates AS t
    WHERE t.org_did = sqlc.arg(org_did)
      AND t.org_pipeline_template_id = sqlc.arg(template_id)
), taken AS (
    SELECT EXISTS (
        SELECT 1 FROM vetchium.org_pipeline_templates AS t
        WHERE t.org_did = sqlc.arg(org_did)
          AND lower(t.name) = lower(sqlc.arg(name)::text)
          AND t.org_pipeline_template_id <> sqlc.arg(template_id)
    ) AS name_taken
), updated AS (
    UPDATE vetchium.org_pipeline_templates AS t
    SET name = sqlc.arg(name)::text, updated_at = now()
    FROM taken
    WHERE t.org_did = sqlc.arg(org_did)
      AND t.org_pipeline_template_id = sqlc.arg(template_id)
      AND NOT taken.name_taken
    RETURNING t.org_pipeline_template_id
), kept AS (
    INSERT INTO vetchium.org_pipeline_template_stages (
        org_pipeline_template_id, position, name, stage_kind
    )
    SELECT updated.org_pipeline_template_id, input.position::smallint,
        input.stage->>'name',
        (input.stage->>'kind')::vetchium.pipeline_stage_kind
    FROM updated
    CROSS JOIN jsonb_array_elements(sqlc.arg(stages)::jsonb)
        WITH ORDINALITY AS input(stage, position)
    ON CONFLICT (org_pipeline_template_id, position) DO UPDATE
    SET name = EXCLUDED.name, stage_kind = EXCLUDED.stage_kind
    RETURNING position
), removed AS (
    DELETE FROM vetchium.org_pipeline_template_stages AS s
    USING updated
    WHERE s.org_pipeline_template_id = updated.org_pipeline_template_id
      AND s.position > jsonb_array_length(sqlc.arg(stages)::jsonb)
    RETURNING s.position
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.pipeline-template.updated',
        'org_pipeline_template', updated.org_pipeline_template_id::text,
        'org_user', sqlc.arg(actor_id)::text, 'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('action', 'updated',
            'stage_count', jsonb_array_length(sqlc.arg(stages)::jsonb),
            'changed_fields', jsonb_build_array('name', 'stages'))
    FROM updated
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM existing) AS found, taken.name_taken,
    (SELECT count(*) FROM updated) AS updated_rows,
    (SELECT count(*) FROM kept) AS stage_rows,
    (SELECT count(*) FROM audit) AS audit_rows
FROM taken;

-- name: DeleteOrgPipelineTemplate :one
WITH deleted AS (
    DELETE FROM vetchium.org_pipeline_templates AS t
    WHERE t.org_did = sqlc.arg(org_did)
      AND t.org_pipeline_template_id = sqlc.arg(template_id)
    RETURNING t.org_pipeline_template_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.pipeline-template.deleted',
        'org_pipeline_template', deleted.org_pipeline_template_id::text,
        'org_user', sqlc.arg(actor_id)::text, 'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('action', 'deleted')
    FROM deleted
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM deleted) AS deleted_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- name: GetOrgOpeningPipeline :one
SELECT o.opening_number, o.version, o.opening_state,
    COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'id', s.org_opening_stage_id, 'name', s.name,
            'kind', s.stage_kind
        ) ORDER BY s.position)
        FROM vetchium.org_opening_stages AS s
        WHERE s.org_opening_id = o.org_opening_id
    ), '[]'::jsonb)::jsonb AS stages
FROM vetchium.org_openings AS o
WHERE o.org_did = sqlc.arg(org_did)
  AND o.opening_number = sqlc.arg(opening_number)::integer;

-- An id the caller marks as existing must already belong to this Opening; the
-- statement changes nothing otherwise and reports the offending positions.
-- name: ReplaceOrgOpeningPipeline :one
WITH input AS (
    SELECT (i.stage->>'id')::uuid AS id,
        (i.stage->>'is_new')::boolean AS is_new,
        i.stage->>'name' AS name, i.stage->>'kind' AS kind,
        i.position::smallint AS position
    FROM jsonb_array_elements(sqlc.arg(stages)::jsonb)
        WITH ORDINALITY AS i(stage, position)
), target AS (
    SELECT o.org_opening_id
    FROM vetchium.org_openings AS o
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.opening_number = sqlc.arg(opening_number)::integer
), unknown AS (
    SELECT COALESCE(array_agg(input.position ORDER BY input.position),
        ARRAY[]::smallint[]) AS positions
    FROM input CROSS JOIN target
    WHERE NOT input.is_new AND NOT EXISTS (
        SELECT 1 FROM vetchium.org_opening_stages AS s
        WHERE s.org_opening_stage_id = input.id
          AND s.org_opening_id = target.org_opening_id
    )
), updated AS (
    UPDATE vetchium.org_openings AS o
    SET version = o.version + 1, updated_at = now()
    FROM unknown
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.opening_number = sqlc.arg(opening_number)::integer
      AND o.version = sqlc.arg(version)::integer
      AND o.opening_state IN ('draft', 'published', 'paused')
      AND cardinality(unknown.positions) = 0
    RETURNING o.org_opening_id, o.opening_number, o.version
), removed AS (
    DELETE FROM vetchium.org_opening_stages AS s
    USING updated
    WHERE s.org_opening_id = updated.org_opening_id
      AND NOT EXISTS (
          SELECT 1 FROM input WHERE input.id = s.org_opening_stage_id
      )
    RETURNING s.org_opening_stage_id
), kept AS (
    INSERT INTO vetchium.org_opening_stages (
        org_opening_stage_id, org_opening_id, position, name, stage_kind
    )
    SELECT input.id, updated.org_opening_id, input.position, input.name,
        input.kind::vetchium.pipeline_stage_kind
    FROM updated CROSS JOIN input
    ON CONFLICT (org_opening_stage_id) DO UPDATE
    SET position = EXCLUDED.position, name = EXCLUDED.name,
        stage_kind = EXCLUDED.stage_kind
    WHERE org_opening_stages.org_opening_id = EXCLUDED.org_opening_id
    RETURNING org_opening_stage_id
), history AS (
    INSERT INTO vetchium.org_opening_history (
        org_opening_history_id, org_opening_id, action,
        actor_org_user_id, opening_version
    )
    SELECT sqlc.arg(history_id), updated.org_opening_id,
        'pipeline_changed', sqlc.arg(actor_id), updated.version
    FROM updated
    RETURNING org_opening_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.opening.pipeline-changed',
        'org_opening', sqlc.arg(org_did)::text || ':' ||
        updated.opening_number::text, 'org_user',
        sqlc.arg(actor_id)::text, 'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('opening_number', updated.opening_number,
            'action', 'pipeline_changed', 'version', updated.version,
            'stage_count', jsonb_array_length(sqlc.arg(stages)::jsonb),
            'changed_fields', jsonb_build_array('pipeline'))
    FROM updated
    RETURNING audit_event_id
)
SELECT to_jsonb(unknown.positions) AS unknown_positions,
    COALESCE((SELECT version FROM updated), 0)::integer AS version,
    (SELECT count(*) FROM kept) AS stage_rows,
    (SELECT count(*) FROM history) AS history_rows,
    (SELECT count(*) FROM audit) AS audit_rows
FROM unknown;
