-- name: GetHubMySubscription :one
SELECT
    u.hub_plan_oid,
    u.subscription_billing_interval,
    u.subscription_anchor_at,
    u.subscription_period_start,
    u.subscription_period_end,
    u.scheduled_hub_plan_oid,
    u.scheduled_billing_interval
FROM vetchium.hub_sessions AS s
JOIN vetchium.hub_users AS u USING (hub_user_did)
WHERE s.hub_session_id = sqlc.arg(hub_session_id)
  AND u.hub_user_did = sqlc.arg(hub_user_did)
  AND s.expires_at > now()
  AND u.hub_user_state = 'active';

-- name: LockHubSubscriptionForChange :one
SELECT
    hub_plan_oid,
    subscription_billing_interval,
    subscription_anchor_at,
    subscription_period_start,
    subscription_period_end,
    scheduled_hub_plan_oid,
    scheduled_billing_interval
FROM vetchium.hub_users
WHERE hub_user_did = sqlc.arg(hub_user_did)
  AND hub_user_state = 'active'
FOR NO KEY UPDATE;

-- name: ClaimDueHubSubscriptions :many
-- The worker passes a non-nil, possibly empty, exclusion slice. pgx v5
-- encodes a nil Go slice as SQL NULL, and `x <> ALL (NULL)` is never true, so
-- the COALESCE also guards a caller that does pass nil.
SELECT
    hub_user_did,
    hub_plan_oid,
    subscription_billing_interval,
    subscription_anchor_at,
    subscription_period_start,
    subscription_period_end,
    scheduled_hub_plan_oid,
    scheduled_billing_interval
FROM vetchium.hub_users
WHERE subscription_period_end <= sqlc.arg(at)
  AND hub_user_did <> ALL (
      COALESCE(sqlc.arg(skipped_hub_user_dids)::uuid[], '{}')
  )
ORDER BY subscription_period_end, hub_user_did
LIMIT sqlc.arg(batch_size)
FOR NO KEY UPDATE SKIP LOCKED;

-- name: SaveHubSubscriptionStates :one
-- The single write statement shared by the set-plan handler and the worker.
-- A jsonb array with explicit `->>`/`->` field extraction lets one statement
-- serve both a single-row caller and a batch caller; sqlc cannot resolve
-- columns from jsonb_to_recordset's column-definition-list form, and parallel
-- unnest arrays would read worse with eight state columns.
WITH states AS (
    SELECT
        (elem ->> 'hub_user_did')::uuid AS hub_user_did,
        (elem ->> 'hub_plan_oid')::text AS hub_plan_oid,
        (elem ->> 'subscription_billing_interval')::
            vetchium.hub_billing_interval AS subscription_billing_interval,
        (elem ->> 'subscription_anchor_at')::timestamptz
            AS subscription_anchor_at,
        (elem ->> 'subscription_period_start')::timestamptz
            AS subscription_period_start,
        (elem ->> 'subscription_period_end')::timestamptz
            AS subscription_period_end,
        (elem ->> 'scheduled_hub_plan_oid')::text AS scheduled_hub_plan_oid,
        (elem ->> 'scheduled_billing_interval')::
            vetchium.hub_billing_interval AS scheduled_billing_interval
    FROM jsonb_array_elements(sqlc.arg(states)::jsonb) AS elem
), updated AS (
    UPDATE vetchium.hub_users AS u
    SET hub_plan_oid = states.hub_plan_oid,
        subscription_billing_interval = states.subscription_billing_interval,
        subscription_anchor_at = states.subscription_anchor_at,
        subscription_period_start = states.subscription_period_start,
        subscription_period_end = states.subscription_period_end,
        scheduled_hub_plan_oid = states.scheduled_hub_plan_oid,
        scheduled_billing_interval = states.scheduled_billing_interval,
        updated_at = now()
    FROM states
    WHERE u.hub_user_did = states.hub_user_did
    RETURNING u.hub_user_did
), events AS (
    SELECT
        (elem ->> 'hub_user_did')::uuid AS hub_user_did,
        (elem ->> 'action')::text AS action,
        (elem ->> 'actor_type')::text AS actor_type,
        (elem ->> 'actor_id')::text AS actor_id,
        (elem -> 'payload')::jsonb AS payload
    FROM jsonb_array_elements(sqlc.arg(events)::jsonb) AS elem
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id,
        action,
        entity_type,
        entity_id,
        actor_type,
        actor_id,
        source,
        idempotency_key,
        payload
    )
    SELECT
        sqlc.arg(tenant_id),
        events.action,
        'hub_subscription',
        events.hub_user_did::text,
        events.actor_type,
        events.actor_id,
        sqlc.arg(source),
        sqlc.narg(idempotency_key),
        events.payload
    FROM events
    JOIN updated ON updated.hub_user_did = events.hub_user_did
    RETURNING audit_event_id, entity_id
)
SELECT
    (SELECT count(*) FROM updated)::bigint AS updated_count,
    (SELECT count(*) FROM audit)::bigint AS audited_count,
    (SELECT count(DISTINCT entity_id) FROM audit)::bigint
        AS audited_user_count;
