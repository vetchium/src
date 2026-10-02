-- name: GetOrgSubscription :one
SELECT
    o.org_plan_oid,
    o.org_billing_interval,
    o.subscription_anchor_at,
    o.subscription_period_start,
    o.subscription_period_end,
    o.scheduled_org_plan_oid,
    o.scheduled_billing_interval,
    o.billing_state,
    o.org_state,
    pm.kind AS payment_method_kind,
    vetchium.org_seats_in_use(o.org_did)::bigint AS seats_in_use,
    oi.org_invoice_id AS open_invoice_id,
    oi.org_plan_oid AS open_invoice_plan_oid,
    oi.billing_interval AS open_invoice_billing_interval,
    oi.period_start AS open_invoice_period_start,
    oi.period_end AS open_invoice_period_end,
    oi.reason AS open_invoice_reason,
    oi.due_at AS open_invoice_due_at,
    oi.attempt_count AS open_invoice_attempt_count,
    oi.next_attempt_at AS open_invoice_next_attempt_at,
    oi.last_failure AS open_invoice_last_failure,
    oi.created_at AS open_invoice_created_at
FROM vetchium.orgs AS o
LEFT JOIN vetchium.org_payment_methods AS pm ON pm.org_did = o.org_did
LEFT JOIN vetchium.org_invoices AS oi
    ON oi.org_did = o.org_did AND oi.invoice_state = 'open'
WHERE o.org_did = sqlc.arg(org_did);

-- Takes the Org row lock that serializes every billing, seat, and permission
-- decision (D28). The open invoice is read under the same lock.
-- name: LockOrgSubscriptionForChange :one
SELECT
    o.org_plan_oid,
    o.org_billing_interval,
    o.subscription_anchor_at,
    o.subscription_period_start,
    o.subscription_period_end,
    o.scheduled_org_plan_oid,
    o.scheduled_billing_interval,
    o.billing_state,
    o.org_state,
    pm.kind AS payment_method_kind,
    vetchium.org_seats_in_use(o.org_did)::bigint AS seats_in_use,
    oi.org_invoice_id AS open_invoice_id,
    oi.org_plan_oid AS open_invoice_plan_oid,
    oi.billing_interval AS open_invoice_billing_interval,
    oi.period_start AS open_invoice_period_start,
    oi.period_end AS open_invoice_period_end,
    oi.reason AS open_invoice_reason,
    oi.due_at AS open_invoice_due_at,
    oi.attempt_count AS open_invoice_attempt_count,
    oi.next_attempt_at AS open_invoice_next_attempt_at,
    oi.last_failure AS open_invoice_last_failure,
    oi.created_at AS open_invoice_created_at
FROM vetchium.orgs AS o
LEFT JOIN vetchium.org_payment_methods AS pm ON pm.org_did = o.org_did
LEFT JOIN vetchium.org_invoices AS oi
    ON oi.org_did = o.org_did AND oi.invoice_state = 'open'
WHERE o.org_did = sqlc.arg(org_did)
FOR UPDATE OF o;

-- The single write statement for a subscription change. invoice_changes and
-- events are jsonb arrays (see backend/internal/orgs/billing): the changes are
-- already folded, so no change refers to a row another change in the same
-- statement creates.
-- name: SaveOrgSubscription :one
WITH updated AS (
    UPDATE vetchium.orgs AS o
    SET org_plan_oid = sqlc.arg(org_plan_oid),
        org_billing_interval =
            sqlc.narg(org_billing_interval)::vetchium.org_billing_interval,
        subscription_anchor_at = sqlc.narg(subscription_anchor_at),
        subscription_period_start = sqlc.narg(subscription_period_start),
        subscription_period_end = sqlc.narg(subscription_period_end),
        scheduled_org_plan_oid = sqlc.narg(scheduled_org_plan_oid),
        scheduled_billing_interval =
            sqlc.narg(scheduled_billing_interval)::vetchium.org_billing_interval,
        billing_state = sqlc.arg(billing_state)::vetchium.org_billing_state,
        updated_at = now()
    WHERE o.org_did = sqlc.arg(org_did)
    RETURNING o.org_did
), changes AS (
    SELECT elem
    FROM jsonb_array_elements(sqlc.arg(invoice_changes)::jsonb) AS elem
), created AS (
    INSERT INTO vetchium.org_invoices (
        org_did, org_plan_oid, billing_interval, period_start, period_end,
        reason, invoice_state, due_at, attempt_count, next_attempt_at,
        last_failure, paid_at, voided_at, paid_by
    )
    SELECT
        sqlc.arg(org_did),
        (c.elem ->> 'plan_oid')::text,
        (c.elem ->> 'billing_interval')::vetchium.org_billing_interval,
        (c.elem ->> 'period_start')::timestamptz,
        (c.elem ->> 'period_end')::timestamptz,
        (c.elem ->> 'reason')::vetchium.org_invoice_reason,
        (c.elem ->> 'state')::vetchium.org_invoice_state,
        (c.elem ->> 'due_at')::timestamptz,
        COALESCE((c.elem ->> 'attempt_count')::integer, 1),
        (c.elem ->> 'next_attempt_at')::timestamptz,
        (c.elem ->> 'last_failure')::vetchium.org_invoice_failure,
        (c.elem ->> 'paid_at')::timestamptz,
        (c.elem ->> 'voided_at')::timestamptz,
        CASE WHEN c.elem ->> 'state' = 'paid'
            THEN sqlc.narg(paid_by)::uuid END
    FROM changes AS c
    WHERE c.elem ->> 'op' = 'create'
    RETURNING org_invoice_id
), paid AS (
    UPDATE vetchium.org_invoices AS i
    SET invoice_state = 'paid',
        paid_at = (c.elem ->> 'paid_at')::timestamptz,
        paid_by = sqlc.narg(paid_by)::uuid,
        due_at = NULL,
        next_attempt_at = NULL
    FROM changes AS c
    WHERE c.elem ->> 'op' = 'pay'
      AND i.org_did = sqlc.arg(org_did)
      AND i.invoice_state = 'open'
    RETURNING i.org_invoice_id
), failed AS (
    UPDATE vetchium.org_invoices AS i
    SET attempt_count = (c.elem ->> 'attempt_count')::integer,
        next_attempt_at = (c.elem ->> 'next_attempt_at')::timestamptz,
        last_failure = (c.elem ->> 'last_failure')::vetchium.org_invoice_failure
    FROM changes AS c
    WHERE c.elem ->> 'op' = 'record-failure'
      AND i.org_did = sqlc.arg(org_did)
      AND i.invoice_state = 'open'
    RETURNING i.org_invoice_id
), voided AS (
    UPDATE vetchium.org_invoices AS i
    SET invoice_state = 'void',
        voided_at = (c.elem ->> 'voided_at')::timestamptz,
        next_attempt_at = NULL
    FROM changes AS c
    WHERE c.elem ->> 'op' = 'void'
      AND i.org_did = sqlc.arg(org_did)
      AND i.invoice_state = 'open'
    RETURNING i.org_invoice_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        (e.elem ->> 'action')::text,
        'org',
        sqlc.arg(org_did)::text,
        (e.elem ->> 'actor_type')::text,
        (e.elem ->> 'actor_id')::text,
        sqlc.arg(source),
        sqlc.arg(idempotency_key),
        e.elem -> 'payload'
    FROM jsonb_array_elements(sqlc.arg(events)::jsonb) AS e(elem)
    RETURNING audit_event_id
)
SELECT
    (SELECT count(*) FROM updated)::bigint AS updated_count,
    (SELECT count(*) FROM created)::bigint AS created_count,
    (SELECT count(*) FROM paid)::bigint AS paid_count,
    (SELECT count(*) FROM failed)::bigint AS failed_count,
    (SELECT count(*) FROM voided)::bigint AS voided_count,
    (SELECT count(*) FROM audit)::bigint AS audited_count;

-- name: SetOrgPaymentMethod :exec
WITH upserted AS (
    INSERT INTO vetchium.org_payment_methods (org_did, kind, created_by)
    VALUES (
        sqlc.arg(org_did),
        sqlc.arg(kind)::text::vetchium.org_payment_method_kind,
        sqlc.arg(actor_org_user_id)
    )
    ON CONFLICT (org_did) DO UPDATE
    SET kind = EXCLUDED.kind,
        created_by = EXCLUDED.created_by,
        created_at = now()
    RETURNING org_did
)
INSERT INTO vetchium.audit_events (
    tenant_id, action, entity_type, entity_id, actor_type, actor_id,
    source, payload
)
SELECT
    sqlc.arg(tenant_id),
    'org.payment_method.set',
    'org',
    org_did::text,
    'org_user',
    sqlc.arg(actor_org_user_id)::uuid::text,
    'orgs-api',
    jsonb_build_object('kind', sqlc.arg(kind)::text)
FROM upserted;

-- name: RemoveOrgPaymentMethod :exec
WITH removed AS (
    DELETE FROM vetchium.org_payment_methods
    WHERE org_did = sqlc.arg(org_did)
    RETURNING org_did, kind
)
INSERT INTO vetchium.audit_events (
    tenant_id, action, entity_type, entity_id, actor_type, actor_id,
    source, payload
)
SELECT
    sqlc.arg(tenant_id),
    'org.payment_method.removed',
    'org',
    org_did::text,
    'org_user',
    sqlc.arg(actor_org_user_id)::uuid::text,
    'orgs-api',
    jsonb_build_object('kind', kind::text)
FROM removed;

-- name: ListOrgInvoices :many
SELECT
    i.org_invoice_id,
    i.org_plan_oid,
    i.billing_interval,
    i.period_start,
    i.period_end,
    i.reason,
    i.invoice_state,
    i.created_at,
    i.due_at,
    i.paid_at,
    i.last_failure,
    i.attempt_count
FROM vetchium.org_invoices AS i
WHERE i.org_did = sqlc.arg(org_did)
  AND (
      sqlc.narg(before_created_at)::timestamptz IS NULL
      OR (i.created_at, i.org_invoice_id) <
          (sqlc.narg(before_created_at)::timestamptz,
           sqlc.narg(before_org_invoice_id)::uuid)
  )
ORDER BY i.created_at DESC, i.org_invoice_id DESC
LIMIT sqlc.arg(page_limit);

-- Read after the Org row lock is held: a function inside the locking statement
-- would count against the statement's older snapshot.
-- name: GetOrgSeatsInUse :one
SELECT vetchium.org_seats_in_use(sqlc.arg(org_did))::bigint AS seats_in_use;
