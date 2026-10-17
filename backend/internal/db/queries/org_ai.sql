-- name: GetOrgAIState :one
SELECT
    o.org_plan_oid,
    o.country,
    o.default_language::text AS default_language,
    COALESCE(s.enabled, false)::boolean AS enabled,
    s.accepted_terms_version,
    s.accepted_terms_at
FROM vetchium.orgs AS o
LEFT JOIN vetchium.org_ai_settings AS s ON s.org_did = o.org_did
WHERE o.org_did = sqlc.arg(org_did);

-- name: ListOrgAIPolicies :many
SELECT operation, allowed_models, default_model
FROM vetchium.org_ai_operation_policies
WHERE org_did = sqlc.arg(org_did)
ORDER BY operation;

-- Replaces the settings and every policy. policies is a JSON array of
-- {operation, allowed_models, default_model}; only the policies that go are
-- deleted, so no two writes touch one key.
-- name: SaveOrgAISettings :one
WITH requested AS (
    SELECT
        e.policy ->> 'operation' AS operation,
        ARRAY(
            SELECT jsonb_array_elements_text(e.policy -> 'allowed_models')
        )::text[] AS allowed_models,
        e.policy ->> 'default_model' AS default_model
    FROM jsonb_array_elements(sqlc.arg(policies)::jsonb) AS e (policy)
), existing AS (
    SELECT
        current_settings.accepted_terms_version,
        current_settings.accepted_terms_by,
        current_settings.accepted_terms_at
    FROM vetchium.org_ai_settings AS current_settings
    WHERE current_settings.org_did = sqlc.arg(org_did)
), saved AS (
    -- PostgreSQL checks the proposed row before it resolves the conflict, so
    -- the proposal already carries an earlier acceptance that is kept.
    INSERT INTO vetchium.org_ai_settings AS s (
        org_did, enabled, accepted_terms_version, accepted_terms_by,
        accepted_terms_at, updated_by, updated_at
    )
    SELECT
        sqlc.arg(org_did)::uuid AS org_did,
        sqlc.arg(enabled)::boolean AS enabled,
        COALESCE(
            sqlc.narg(accept_terms_version)::text, e.accepted_terms_version
        ) AS accepted_terms_version,
        CASE WHEN sqlc.narg(accept_terms_version)::text IS NULL
            THEN e.accepted_terms_by
            ELSE sqlc.arg(actor_org_user_id)::uuid END AS accepted_terms_by,
        CASE WHEN sqlc.narg(accept_terms_version)::text IS NULL
            THEN e.accepted_terms_at
            ELSE now() END AS accepted_terms_at,
        sqlc.arg(actor_org_user_id)::uuid AS updated_by,
        now() AS updated_at
    FROM (SELECT 1 AS seed) AS seed
    LEFT JOIN existing AS e ON true
    ON CONFLICT (org_did) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        accepted_terms_version = EXCLUDED.accepted_terms_version,
        accepted_terms_by = EXCLUDED.accepted_terms_by,
        accepted_terms_at = EXCLUDED.accepted_terms_at,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
    RETURNING s.org_did
), removed AS (
    DELETE FROM vetchium.org_ai_operation_policies AS p
    WHERE p.org_did = sqlc.arg(org_did)
      AND p.operation NOT IN (SELECT r.operation FROM requested AS r)
    RETURNING p.operation
), upserted AS (
    INSERT INTO vetchium.org_ai_operation_policies (
        org_did, operation, allowed_models, default_model
    )
    SELECT sqlc.arg(org_did), r.operation, r.allowed_models, r.default_model
    FROM requested AS r
    ON CONFLICT (org_did, operation) DO UPDATE SET
        allowed_models = EXCLUDED.allowed_models,
        default_model = EXCLUDED.default_model
    RETURNING operation
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'org.ai_settings.changed', 'org',
        saved.org_did::text, 'org_user',
        sqlc.arg(actor_org_user_id)::uuid::text, saved.org_did, 'orgs-api',
        sqlc.narg(idempotency_key),
        jsonb_strip_nulls(jsonb_build_object(
            'enabled', sqlc.arg(enabled)::boolean,
            'accepted_terms_version', sqlc.narg(accept_terms_version)::text,
            'policy_operations', (
                SELECT COALESCE(jsonb_agg(r.operation ORDER BY r.operation),
                    '[]'::jsonb)
                FROM requested AS r
            )
        ))
    FROM saved
    RETURNING audit_event_id
)
SELECT
    (SELECT count(*) FROM saved)::integer AS saved_count,
    (SELECT count(*) FROM upserted)::integer AS upserted_count,
    (SELECT count(*) FROM audit)::integer AS audit_count;

-- Serializes every change to an Org's credit balance: reservations,
-- settlements, and purchases.
-- name: LockOrgAICredits :exec
SELECT pg_advisory_xact_lock(hashtextextended(
    'org-ai-credits:' || sqlc.arg(org_did)::uuid::text, 0
));

-- A grant counts only while the plan allows AI; the caller passes those plans.
-- name: GetOrgAICreditBalance :one
SELECT
    o.org_plan_oid,
    COALESCE(sum(l.credits_remaining) FILTER (
        WHERE l.kind = 'grant'
          AND o.org_plan_oid = ANY(sqlc.arg(ai_plan_oids)::text[])
    ), 0)::bigint AS grant_remaining,
    min(l.expires_at) FILTER (
        WHERE l.kind = 'grant' AND l.credits_remaining > 0
          AND o.org_plan_oid = ANY(sqlc.arg(ai_plan_oids)::text[])
    )::timestamptz AS grant_expires_at,
    COALESCE(sum(l.credits_remaining) FILTER (
        WHERE l.kind = 'purchase'
    ), 0)::bigint AS purchased_remaining,
    (
        SELECT COALESCE(sum(u.credits_reserved), 0)
        FROM vetchium.org_ai_usage AS u
        WHERE u.org_did = o.org_did AND u.usage_state = 'reserved'
    )::bigint AS reserved,
    COALESCE(sum(l.credits_granted) FILTER (
        WHERE l.kind = 'purchase'
           OR o.org_plan_oid = ANY(sqlc.arg(ai_plan_oids)::text[])
    ), 0)::bigint AS usable_total
FROM vetchium.orgs AS o
-- Spent lots stay joined so usable_total counts them.
LEFT JOIN vetchium.org_ai_credit_lots AS l
    ON l.org_did = o.org_did
   AND l.expires_at > now()
WHERE o.org_did = sqlc.arg(org_did)
GROUP BY o.org_did, o.org_plan_oid;

-- name: CreateOrgAIUsageReservation :one
WITH reserved AS (
    INSERT INTO vetchium.org_ai_usage (
        usage_id, org_did, org_user_id, operation, model_oid, host_model,
        input_credits_per_million, output_credits_per_million,
        credits_reserved, idempotency_key
    )
    VALUES (
        sqlc.arg(usage_id), sqlc.arg(org_did), sqlc.arg(org_user_id),
        sqlc.arg(operation), sqlc.arg(model_oid), sqlc.arg(host_model),
        sqlc.arg(input_credits_per_million),
        sqlc.arg(output_credits_per_million),
        sqlc.arg(credits_reserved), sqlc.arg(idempotency_key)
    )
    RETURNING usage_id, org_did, operation, model_oid, credits_reserved
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'org.ai_usage.reserved', 'org_ai_usage',
        r.usage_id::text, 'org_user', sqlc.arg(org_user_id)::uuid::text,
        r.org_did, 'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object(
            'operation', r.operation, 'model_oid', r.model_oid,
            'credits_reserved', r.credits_reserved
        )
    FROM reserved AS r
    RETURNING audit_event_id
)
SELECT r.usage_id, (SELECT count(*) FROM audit)::integer AS audit_count
FROM reserved AS r;

-- Locked before settling or releasing, so the reservation reaper cannot
-- abandon the row in between.
-- name: LockOrgAIUsage :one
SELECT usage_state, credits_reserved
FROM vetchium.org_ai_usage
WHERE usage_id = sqlc.arg(usage_id) AND org_did = sqlc.arg(org_did)
FOR UPDATE;

-- Charges at most what the usable lots hold: the grant first while the plan
-- allows AI, then purchases by earliest expiry. A shortfall, such as a grant
-- that lapsed during the call, is not charged.
-- name: SettleOrgAIUsage :one
WITH usable AS (
    SELECT
        l.lot_id, l.credits_remaining,
        sum(l.credits_remaining) OVER (
            ORDER BY (l.kind = 'purchase'), l.expires_at, l.lot_id
        ) AS running
    FROM vetchium.org_ai_credit_lots AS l
    JOIN vetchium.orgs AS o ON o.org_did = l.org_did
    WHERE l.org_did = sqlc.arg(org_did)
      AND l.credits_remaining > 0
      AND l.expires_at > now()
      AND (l.kind = 'purchase'
          OR o.org_plan_oid = ANY(sqlc.arg(ai_plan_oids)::text[]))
), charge AS (
    SELECT LEAST(
        sqlc.arg(credits_charged)::bigint,
        COALESCE((SELECT max(u.running) FROM usable AS u), 0)
    )::bigint AS amount
), debited AS (
    UPDATE vetchium.org_ai_credit_lots AS l
    SET credits_remaining = l.credits_remaining - LEAST(
        u.credits_remaining,
        c.amount - (u.running - u.credits_remaining)
    )
    FROM usable AS u
    CROSS JOIN charge AS c
    WHERE l.lot_id = u.lot_id
      AND u.running - u.credits_remaining < c.amount
    RETURNING l.lot_id
), settled AS (
    UPDATE vetchium.org_ai_usage AS u
    SET usage_state = 'settled', finished_at = now(),
        input_tokens = sqlc.arg(input_tokens),
        output_tokens = sqlc.arg(output_tokens),
        credits_charged = (SELECT c.amount FROM charge AS c)
    WHERE u.usage_id = sqlc.arg(usage_id)
      AND u.org_did = sqlc.arg(org_did)
      AND u.usage_state = 'reserved'
    RETURNING u.usage_id, u.org_did, u.org_user_id, u.credits_charged
), kept AS (
    INSERT INTO vetchium.org_ai_usage_texts (
        usage_id, request_messages, response_text, expires_at
    )
    SELECT s.usage_id, sqlc.arg(request_messages)::jsonb,
        sqlc.narg(response_text), sqlc.arg(text_expires_at)
    FROM settled AS s
    RETURNING usage_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'org.ai_usage.settled', 'org_ai_usage',
        s.usage_id::text, 'org_user', s.org_user_id::text, s.org_did,
        'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object(
            'credits_charged', s.credits_charged,
            'input_tokens', sqlc.arg(input_tokens)::integer,
            'output_tokens', sqlc.arg(output_tokens)::integer
        )
    FROM settled AS s
    RETURNING audit_event_id
)
SELECT
    s.credits_charged,
    (SELECT count(*) FROM kept)::integer AS kept_count,
    (SELECT count(*) FROM audit)::integer AS audit_count
FROM settled AS s;

-- name: ReleaseOrgAIUsage :one
WITH released AS (
    UPDATE vetchium.org_ai_usage AS u
    SET usage_state = 'released', finished_at = now(),
        failure_reason = sqlc.arg(failure_reason),
        input_tokens = sqlc.narg(input_tokens),
        output_tokens = sqlc.narg(output_tokens)
    WHERE u.usage_id = sqlc.arg(usage_id)
      AND u.org_did = sqlc.arg(org_did)
      AND u.usage_state = 'reserved'
    RETURNING u.usage_id, u.org_did, u.org_user_id, u.failure_reason
), kept AS (
    INSERT INTO vetchium.org_ai_usage_texts (
        usage_id, request_messages, response_text, expires_at
    )
    SELECT r.usage_id, sqlc.arg(request_messages)::jsonb,
        sqlc.narg(response_text), sqlc.arg(text_expires_at)
    FROM released AS r
    RETURNING usage_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'org.ai_usage.released', 'org_ai_usage',
        r.usage_id::text, 'org_user', r.org_user_id::text, r.org_did,
        'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('failure_reason', r.failure_reason)
    FROM released AS r
    RETURNING audit_event_id
)
SELECT
    (SELECT count(*) FROM released)::integer AS released_count,
    (SELECT count(*) FROM kept)::integer AS kept_count,
    (SELECT count(*) FROM audit)::integer AS audit_count;

-- name: BuyOrgAICreditPack :one
WITH purchased AS (
    INSERT INTO vetchium.org_ai_credit_lots (
        lot_id, org_did, kind, pack_id, purchased_by, credits_granted,
        credits_remaining, expires_at
    )
    SELECT
        sqlc.arg(lot_id), o.org_did, 'purchase', sqlc.arg(pack_id),
        sqlc.arg(actor_org_user_id), sqlc.arg(credits), sqlc.arg(credits),
        now() + interval '12 months'
    FROM vetchium.orgs AS o
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.org_plan_oid = ANY(sqlc.arg(ai_plan_oids)::text[])
    RETURNING lot_id, org_did, pack_id, credits_granted
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'org.ai_credits.purchased', 'org_ai_credit_lot',
        p.lot_id::text, 'org_user', sqlc.arg(actor_org_user_id)::uuid::text,
        p.org_did, 'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object(
            'pack_id', p.pack_id, 'credits', p.credits_granted,
            'price_currency', sqlc.arg(price_currency)::text,
            'price_amount_minor', sqlc.arg(price_amount_minor)::bigint,
            'payment', 'simulated'
        )
    FROM purchased AS p
    RETURNING audit_event_id
)
SELECT p.lot_id, (SELECT count(*) FROM audit)::integer AS audit_count
FROM purchased AS p;

-- name: ListOrgAICreditLots :many
SELECT
    lot_id, kind, pack_id, credits_granted, credits_remaining, created_at,
    expires_at
FROM vetchium.org_ai_credit_lots
WHERE org_did = sqlc.arg(org_did)
  AND (sqlc.narg(after_created_at)::timestamptz IS NULL
      OR (created_at, lot_id) < (
          sqlc.narg(after_created_at)::timestamptz,
          sqlc.narg(after_lot_id)::uuid))
ORDER BY created_at DESC, lot_id DESC
LIMIT sqlc.arg(page_limit);

-- name: ListOrgAIUsage :many
SELECT
    u.usage_id, u.operation, u.model_oid, actor.email_address AS actor_email,
    u.usage_state, u.failure_reason, u.input_tokens, u.output_tokens,
    u.credits_charged, u.created_at,
    EXISTS (
        SELECT 1 FROM vetchium.org_ai_usage_texts AS t
        WHERE t.usage_id = u.usage_id AND t.expires_at > now()
    )::boolean AS text_available
FROM vetchium.org_ai_usage AS u
JOIN vetchium.org_users AS actor ON actor.org_user_id = u.org_user_id
WHERE u.org_did = sqlc.arg(org_did)
  AND (sqlc.narg(after_created_at)::timestamptz IS NULL
      OR (u.created_at, u.usage_id) < (
          sqlc.narg(after_created_at)::timestamptz,
          sqlc.narg(after_usage_id)::uuid))
ORDER BY u.created_at DESC, u.usage_id DESC
LIMIT sqlc.arg(page_limit);

-- name: GetOrgAIUsageText :one
SELECT u.operation, t.request_messages, t.response_text, t.expires_at
FROM vetchium.org_ai_usage AS u
JOIN vetchium.org_ai_usage_texts AS t ON t.usage_id = u.usage_id
WHERE u.usage_id = sqlc.arg(usage_id)
  AND u.org_did = sqlc.arg(org_did)
  AND t.expires_at > now();

-- Grants this UTC month's credits to active Orgs on a plan that includes them.
-- plan_oids and credits are parallel arrays from the plan contract.
-- name: GrantOrgAICredits :one
WITH plans AS (
    SELECT
        unnest(sqlc.arg(plan_oids)::text[]) AS plan_oid,
        unnest(sqlc.arg(credits)::bigint[]) AS credits
), this_month AS (
    SELECT date_trunc('month', now() AT TIME ZONE 'UTC')::date AS month
), due AS (
    SELECT o.org_did, p.credits
    FROM vetchium.orgs AS o
    JOIN plans AS p ON p.plan_oid = o.org_plan_oid
    CROSS JOIN this_month AS m
    WHERE o.org_state = 'active'
      AND p.credits > 0
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_ai_credit_lots AS l
          WHERE l.org_did = o.org_did AND l.grant_month = m.month
      )
    ORDER BY o.org_did
    LIMIT 100
), granted AS (
    INSERT INTO vetchium.org_ai_credit_lots (
        lot_id, org_did, kind, grant_month, credits_granted,
        credits_remaining, expires_at
    )
    SELECT
        gen_random_uuid(), d.org_did, 'grant', m.month, d.credits, d.credits,
        (m.month + interval '1 month')::timestamp AT TIME ZONE 'UTC'
    FROM due AS d
    CROSS JOIN this_month AS m
    ON CONFLICT (org_did, grant_month) DO NOTHING
    RETURNING lot_id, org_did, grant_month, credits_granted
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'org.ai_credits.granted', 'org_ai_credit_lot',
        g.lot_id::text, 'worker', 'ai-credit-grant', g.org_did, 'workers',
        jsonb_build_object(
            'grant_month', g.grant_month, 'credits', g.credits_granted
        )
    FROM granted AS g
    RETURNING audit_event_id
)
SELECT
    (SELECT count(*) FROM granted)::integer AS granted_count,
    (SELECT count(*) FROM audit)::integer AS audit_count;

-- Releases reservations whose request never settled, charging nothing.
-- name: AbandonOrgAIReservations :one
WITH stale AS (
    SELECT usage_id
    FROM vetchium.org_ai_usage
    WHERE usage_state = 'reserved'
      AND created_at < sqlc.arg(reserved_before)::timestamptz
    ORDER BY created_at, usage_id
    LIMIT 100
    FOR UPDATE SKIP LOCKED
), abandoned AS (
    UPDATE vetchium.org_ai_usage AS u
    SET usage_state = 'abandoned', failure_reason = 'abandoned',
        finished_at = now()
    FROM stale
    WHERE u.usage_id = stale.usage_id AND u.usage_state = 'reserved'
    RETURNING u.usage_id, u.org_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'org.ai_usage.abandoned', 'org_ai_usage',
        a.usage_id::text, 'worker', 'ai-reservation-reaper', a.org_did,
        'workers', '{}'::jsonb
    FROM abandoned AS a
    RETURNING audit_event_id
)
SELECT
    (SELECT count(*) FROM abandoned)::integer AS abandoned_count,
    (SELECT count(*) FROM audit)::integer AS audit_count;

-- name: DeleteExpiredOrgAIUsageTexts :one
WITH expired AS (
    SELECT usage_id
    FROM vetchium.org_ai_usage_texts
    WHERE expires_at <= now()
    ORDER BY expires_at, usage_id
    LIMIT 1000
    FOR UPDATE SKIP LOCKED
), deleted AS (
    DELETE FROM vetchium.org_ai_usage_texts AS t
    USING expired
    WHERE t.usage_id = expired.usage_id
    RETURNING t.usage_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'org.ai_usage_texts.deleted', 'org_ai_usage_text',
        'retention', 'worker', 'ai-text-retention', 'workers',
        jsonb_build_object('deleted_count', count(*))
    FROM deleted
    HAVING count(*) > 0
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM deleted)::integer AS deleted_count;

-- name: GetOrgDIDForClaimedDomain :one
SELECT org_did
FROM vetchium.org_domains
WHERE domain = sqlc.arg(domain) AND domain_state <> 'released';

-- Reading kept text is itself audited, in the same statement.
-- name: ReadOrgAIUsageTextForAdmin :one
WITH found AS (
    SELECT u.usage_id, u.org_did, t.request_messages, t.response_text,
        t.expires_at
    FROM vetchium.org_ai_usage AS u
    JOIN vetchium.org_ai_usage_texts AS t ON t.usage_id = u.usage_id
    WHERE u.usage_id = sqlc.arg(usage_id)
      AND u.org_did = sqlc.arg(org_did)
      AND t.expires_at > now()
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'admin.org_ai_usage_text.viewed',
        'org_ai_usage', f.usage_id::text, 'admin',
        sqlc.arg(admin_user_id)::uuid::text, f.org_did, 'admin-api',
        '{}'::jsonb
    FROM found AS f
    RETURNING audit_event_id
)
SELECT
    f.request_messages, f.response_text, f.expires_at,
    (SELECT count(*) FROM audit)::integer AS audit_count
FROM found AS f;
