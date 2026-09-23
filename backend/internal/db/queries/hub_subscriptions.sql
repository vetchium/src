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
), previous AS (
    SELECT u.hub_user_did, u.hub_plan_oid, u.profile_alias,
        EXISTS (
            SELECT 1
            FROM vetchium.hub_profile_picture_objects AS picture
            WHERE picture.hub_user_did = u.hub_user_did
              AND picture.state = 'active'
        ) AS had_profile_picture,
        EXISTS (
            SELECT 1
            FROM vetchium.hub_profile_picture_objects AS picture
            WHERE picture.hub_user_did = u.hub_user_did
              AND picture.state = 'uploading'
        ) AS had_staged_picture
    FROM vetchium.hub_users AS u
    JOIN states USING (hub_user_did)
    FOR UPDATE OF u
), updated AS (
    UPDATE vetchium.hub_users AS u
    SET hub_plan_oid = states.hub_plan_oid,
        subscription_billing_interval = states.subscription_billing_interval,
        subscription_anchor_at = states.subscription_anchor_at,
        subscription_period_start = states.subscription_period_start,
        subscription_period_end = states.subscription_period_end,
        scheduled_hub_plan_oid = states.scheduled_hub_plan_oid,
        scheduled_billing_interval = states.scheduled_billing_interval,
        profile_alias = CASE
            WHEN previous.hub_plan_oid <> 'hub-free-tier'
                AND states.hub_plan_oid = 'hub-free-tier' THEN NULL
            ELSE u.profile_alias
        END,
        profile_version = u.profile_version + CASE
            WHEN previous.hub_plan_oid <> 'hub-free-tier'
                AND states.hub_plan_oid = 'hub-free-tier'
                AND (previous.profile_alias IS NOT NULL OR
                    previous.had_profile_picture) THEN 1
            ELSE 0
        END,
        updated_at = now()
    FROM states
    JOIN previous USING (hub_user_did)
    WHERE u.hub_user_did = states.hub_user_did
    RETURNING u.hub_user_did, u.profile_version,
        previous.profile_alias AS released_alias,
        previous.had_profile_picture,
        previous.had_staged_picture,
        previous.hub_plan_oid <> 'hub-free-tier'
            AND states.hub_plan_oid = 'hub-free-tier' AS downgraded
), pictures_queued AS (
    UPDATE vetchium.hub_profile_picture_objects AS picture
    SET state = 'pending_delete', delete_requested_at = now(),
        upload_expires_at = NULL,
        -- A concurrent replay can still be writing a formerly active object.
        -- Bound PutObject to 30 seconds and defer every delete beyond that.
        next_attempt_at = now() + interval '1 minute'
    FROM updated
    WHERE picture.hub_user_did = updated.hub_user_did
      AND updated.downgraded
      AND picture.state IN ('active', 'uploading')
    RETURNING picture.object_id, picture.hub_user_did
), alias_release_commands AS (
    SELECT updated.hub_user_did, updated.released_alias,
        gen_random_uuid() AS operation_id,
        gen_random_uuid() AS command_id,
        jsonb_build_object(
            'hub_user_did', updated.hub_user_did,
            'profile_alias', NULL,
            'downgrade_release_if_alias', updated.released_alias
        ) AS payload
    FROM updated
    WHERE updated.downgraded AND updated.released_alias IS NOT NULL
), alias_releases AS (
    INSERT INTO vetchium.federation_operations (
        operation_id, command_id, kind, target_authority, aggregate_id,
        owner_principal_type, owner_principal_id, idempotency_key,
        request_digest, payload_bytes, expires_at
    )
    SELECT operation_id, command_id, 'hub-alias-release',
        'global-directory', hub_user_did::text, 'hub_user',
        hub_user_did::text, operation_id::text,
        sha256(convert_to(payload::text, 'UTF8')),
        convert_to(payload::text, 'UTF8'), now() + interval '30 days'
    FROM alias_release_commands
    RETURNING operation_id
), profile_cleanup_audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.entitlements-removed',
        'hub_user', updated.hub_user_did::text,
        CASE WHEN sqlc.arg(source)::text = 'workers'
            THEN 'worker' ELSE 'hub_user' END,
        CASE WHEN sqlc.arg(source)::text = 'workers'
            THEN NULL ELSE updated.hub_user_did::text END,
        sqlc.arg(source), jsonb_build_object(
            'alias_release_scheduled', updated.released_alias IS NOT NULL,
            'picture_deletion_scheduled',
                updated.had_profile_picture OR updated.had_staged_picture,
            'profile_version', updated.profile_version
        )
    FROM updated
    WHERE updated.downgraded
      AND (updated.released_alias IS NOT NULL OR
          updated.had_profile_picture OR updated.had_staged_picture)
    RETURNING audit_event_id
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
        AS audited_user_count,
    (SELECT count(*) FROM alias_releases)::bigint AS alias_release_count,
    (SELECT count(*) FROM pictures_queued)::bigint AS picture_deletion_count,
    (SELECT count(*) FROM profile_cleanup_audit)::bigint
        AS profile_cleanup_audit_count;

-- name: ListHubUsersWithEndingSubscriptions :many
-- Candidates for a subscription-ending warning: a paid plan with a scheduled
-- change, and a period end inside the widest lead window. Whether the
-- scheduled plan is genuinely lower stays a Go-side decision, since plan
-- ranks are a TypeSpec contract concept the database does not hold. The
-- exclusion list plays the same role as ClaimDueHubSubscriptions' above: it
-- lets one run walk multiple batches without re-selecting rows it already
-- looked at, without needing to lock or mutate hub_users.
SELECT
    hub_user_did,
    email_address,
    display_name,
    preferred_language,
    hub_plan_oid,
    scheduled_hub_plan_oid,
    subscription_period_end
FROM vetchium.hub_users
WHERE hub_user_state = 'active'
  AND hub_plan_oid <> 'hub-free-tier'
  AND scheduled_hub_plan_oid IS NOT NULL
  AND subscription_period_end > sqlc.arg(at)
  AND subscription_period_end <= sqlc.arg(at) + interval '7 days'
  AND hub_user_did <> ALL (
      COALESCE(sqlc.arg(skipped_hub_user_dids)::uuid[], '{}')
  )
ORDER BY subscription_period_end, hub_user_did
LIMIT sqlc.arg(batch_size);

-- name: RecordHubSubscriptionExpiryNotice :one
-- Queues the warning email, records the notice, and audits the operation in
-- one statement. ON CONFLICT DO NOTHING makes a retried or repeated tick a
-- no-op: when the notice already exists, the outbox and audit CTEs have
-- nothing to select from and queued comes back false.
WITH inserted AS (
    INSERT INTO vetchium.hub_subscription_expiry_notices (
        hub_user_did, period_end, lead_time
    )
    VALUES (
        sqlc.arg(hub_user_did), sqlc.arg(period_end), sqlc.arg(lead_time)
    )
    ON CONFLICT ON CONSTRAINT hub_subscription_expiry_notices_key
        DO NOTHING
    RETURNING hub_subscription_expiry_notice_id
), outbox AS (
    INSERT INTO vetchium.hub_email_outbox (
        kind, recipient_email_address, preferred_language, payload_ciphertext
    )
    SELECT 'subscription-ending', sqlc.arg(recipient_email_address),
        sqlc.arg(preferred_language), sqlc.arg(payload_ciphertext)
    FROM inserted
    RETURNING hub_email_outbox_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.subscription.expiry-notice-queued',
        'hub_subscription',
        sqlc.arg(hub_user_did)::text,
        'worker',
        'subscription-expiry-warning',
        'workers',
        jsonb_build_object(
            'lead_time', sqlc.arg(lead_time)::text,
            'period_end', sqlc.arg(period_end),
            'scheduled_hub_plan_oid', sqlc.arg(scheduled_hub_plan_oid)::text
        )
    FROM outbox
    RETURNING audit_event_id
)
SELECT EXISTS (SELECT 1 FROM audit) AS queued;
