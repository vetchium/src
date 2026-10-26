-- Billable facts derived from recording actions (agent-guides/marketplace.md,
-- MKT-STM-001 to MKT-STM-004). Facts are stored authoritatively on the consumer tenant.

-- name: InsertActivityFact :exec
INSERT INTO vetchium.org_activity_facts (
    fact_id, org_did, engagement_id, org_application_id, fact_date,
    fact_kind, reference_id, opening_number, opening_title,
    application_number, applicant_display_name, corrected, recorded_at
) VALUES (
    gen_random_uuid(),
    sqlc.arg(org_did),
    sqlc.arg(engagement_id),
    sqlc.arg(org_application_id),
    sqlc.arg(fact_date)::date,
    sqlc.arg(fact_kind),
    sqlc.arg(reference_id),
    sqlc.arg(opening_number),
    sqlc.arg(opening_title),
    sqlc.arg(application_number),
    sqlc.arg(applicant_display_name),
    sqlc.arg(corrected),
    now()
)
ON CONFLICT (engagement_id, org_application_id, fact_kind, reference_id)
DO NOTHING;

-- name: UpsertCorrectedActivityFact :exec
INSERT INTO vetchium.org_activity_facts (
    fact_id, org_did, engagement_id, org_application_id, fact_date,
    fact_kind, reference_id, opening_number, opening_title,
    application_number, applicant_display_name, corrected, recorded_at
) VALUES (
    gen_random_uuid(),
    sqlc.arg(org_did),
    sqlc.arg(engagement_id),
    sqlc.arg(org_application_id),
    sqlc.arg(fact_date)::date,
    sqlc.arg(fact_kind),
    sqlc.arg(reference_id),
    sqlc.arg(opening_number),
    sqlc.arg(opening_title),
    sqlc.arg(application_number),
    sqlc.arg(applicant_display_name),
    true,
    now()
)
ON CONFLICT (engagement_id, org_application_id, fact_kind, reference_id)
DO UPDATE SET
    fact_date = EXCLUDED.fact_date,
    corrected = true,
    recorded_at = now();

-- name: ListActivityStatementFacts :many
SELECT f.fact_id, f.fact_date, f.fact_kind, f.opening_number, f.opening_title,
    f.application_number, f.applicant_display_name, f.corrected
FROM vetchium.org_activity_facts AS f
WHERE f.engagement_id = sqlc.arg(engagement_id)
  AND f.fact_date >= sqlc.arg(start_date)::date
  AND f.fact_date <= sqlc.arg(end_date)::date
  AND (
      sqlc.narg(after_date)::date IS NULL
      OR (f.fact_date, f.fact_id) > (sqlc.narg(after_date)::date, sqlc.narg(after_fact_id)::uuid)
  )
ORDER BY f.fact_date ASC, f.fact_id ASC
LIMIT sqlc.arg(page_limit);

-- Deletes one batch of facts of engagements terminal for three years
-- (MKT-STM-004), oldest engagement first, with one audit event per batch.
-- name: PruneTerminalEngagementActivityFacts :one
WITH due AS (
    SELECT f.fact_id
    FROM vetchium.org_activity_facts AS f
    JOIN vetchium.org_engagements AS e ON e.engagement_id = f.engagement_id
    WHERE e.engagement_state IN ('declined', 'withdrawn', 'expired', 'ended')
      AND COALESCE(e.ended_at, e.decided_at, e.updated_at)
          <= now() - interval '3 years'
    ORDER BY f.fact_id
    LIMIT sqlc.arg(batch_size)
), pruned AS (
    DELETE FROM vetchium.org_activity_facts AS f
    USING due
    WHERE f.fact_id = due.fact_id
    RETURNING f.fact_id, f.engagement_id
), summary AS (
    SELECT count(*)::bigint AS facts_pruned,
        COALESCE(jsonb_agg(DISTINCT pruned.engagement_id::text), '[]'::jsonb)
            AS engagements
    FROM pruned
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.activity_facts.pruned', 'engagement_facts',
        gen_random_uuid()::text, 'worker', 'workers', 'workers',
        jsonb_build_object('facts_pruned', summary.facts_pruned,
            'engagements', summary.engagements)
    FROM summary
    WHERE summary.facts_pruned > 0
)
SELECT facts_pruned FROM summary;
