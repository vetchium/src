-- name: CreateFederationOperation :one
WITH created AS (
    INSERT INTO vetchium.federation_operations (
        operation_id, command_id, kind, target_authority, aggregate_id,
        owner_principal_type, owner_principal_id, idempotency_key,
        request_digest, payload_bytes, expires_at
    )
    VALUES (
        sqlc.arg(operation_id), sqlc.arg(command_id), sqlc.arg(kind),
        sqlc.arg(target_authority), sqlc.arg(aggregate_id),
        sqlc.arg(owner_principal_type), sqlc.arg(owner_principal_id),
        sqlc.arg(idempotency_key), sqlc.arg(request_digest),
        sqlc.arg(payload_bytes), sqlc.arg(expires_at)
    )
    RETURNING operation_id, command_id, kind, target_authority, aggregate_id,
        owner_principal_type, owner_principal_id, idempotency_key,
        request_digest, payload_bytes, state, response_status,
        response_ciphertext, attempt_count, next_attempt_at, last_error,
        created_at, updated_at, completed_at, expires_at,
        authority_principal_type, authority_principal_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'federation.operation.created', 'federation_operation',
        o.operation_id::text, sqlc.arg(actor_type), sqlc.narg(actor_id),
        sqlc.arg(source), o.idempotency_key,
        jsonb_build_object('kind', o.kind, 'aggregate_id', o.aggregate_id)
    FROM created AS o
)
SELECT operation_id, command_id, kind, target_authority, aggregate_id,
    owner_principal_type, owner_principal_id, idempotency_key,
    request_digest, payload_bytes, state, response_status,
    response_ciphertext, attempt_count, next_attempt_at, last_error,
    created_at, updated_at, completed_at, expires_at,
    authority_principal_type, authority_principal_did
FROM created;

-- name: GetFederationOperation :one
SELECT operation_id, command_id, kind, target_authority, aggregate_id,
    owner_principal_type, owner_principal_id, idempotency_key,
    request_digest, payload_bytes, state, response_status,
    response_ciphertext, attempt_count, next_attempt_at, last_error,
    created_at, updated_at, completed_at, expires_at,
    authority_principal_type, authority_principal_did
FROM vetchium.federation_operations
WHERE operation_id = sqlc.arg(operation_id)
  AND expires_at > now();

-- name: GetFederationOperationByIdempotency :one
SELECT operation_id, command_id, kind, target_authority, aggregate_id,
    owner_principal_type, owner_principal_id, idempotency_key,
    request_digest, payload_bytes, state, response_status,
    response_ciphertext, attempt_count, next_attempt_at, last_error,
    created_at, updated_at, completed_at, expires_at,
    authority_principal_type, authority_principal_did
FROM vetchium.federation_operations
WHERE kind = sqlc.arg(kind)
  AND aggregate_id = sqlc.arg(aggregate_id)
  AND idempotency_key = sqlc.arg(idempotency_key)
  AND expires_at > now();

-- name: ListRecoverableFederationOperations :many
SELECT operation_id, command_id, kind, target_authority, aggregate_id,
    owner_principal_type, owner_principal_id, idempotency_key,
    request_digest, payload_bytes, state, response_status,
    response_ciphertext, attempt_count, next_attempt_at, last_error,
    created_at, updated_at, completed_at, expires_at,
    authority_principal_type, authority_principal_did
FROM vetchium.federation_operations
WHERE state = 'pending' AND next_attempt_at <= now()
ORDER BY next_attempt_at, created_at, operation_id
LIMIT sqlc.arg(batch_size);

-- name: ListRecoverableHubAliasReleases :many
SELECT operation_id, command_id, kind, target_authority, aggregate_id,
    owner_principal_type, owner_principal_id, idempotency_key,
    request_digest, payload_bytes, state, response_status,
    response_ciphertext, attempt_count, next_attempt_at, last_error,
    created_at, updated_at, completed_at, expires_at,
    authority_principal_type, authority_principal_did
FROM vetchium.federation_operations
WHERE kind = 'hub-alias-release'
  AND state = 'pending' AND next_attempt_at <= now()
ORDER BY next_attempt_at, created_at, operation_id
LIMIT sqlc.arg(batch_size);

-- name: GetHubFederationOperationStatus :one
SELECT operation_id, state
FROM vetchium.federation_operations
WHERE operation_id = sqlc.arg(operation_id)
  AND owner_principal_type = 'hub_user'
  AND owner_principal_id = sqlc.arg(owner_principal_id)
  AND expires_at > now();

-- Steps after creation are keyed by the operation id, like the other durable
-- steps an operation drives; only creation carries the caller's key.
-- The final SELECT's row count is the affected-row count.
-- name: RecordFederationOperationRetry :execrows
WITH updated AS (
    UPDATE vetchium.federation_operations
    SET attempt_count = attempt_count + 1,
        next_attempt_at = now() + LEAST(
            interval '5 minutes',
            interval '1 second' * power(2, LEAST(attempt_count, 8))
        ),
        last_error = left(sqlc.arg(last_error), 200),
        updated_at = now()
    WHERE operation_id = sqlc.arg(operation_id) AND state = 'pending'
    RETURNING operation_id, idempotency_key, kind, attempt_count
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'federation.operation.retry-scheduled',
        'federation_operation',
        o.operation_id::text, sqlc.arg(actor_type), sqlc.narg(actor_id),
        sqlc.arg(source), o.operation_id::text,
        jsonb_build_object('kind', o.kind, 'attempt', o.attempt_count)
    FROM updated AS o
)
SELECT u.operation_id FROM updated AS u;

-- name: ResolveFederationOperation :one
WITH resolved AS (
    UPDATE vetchium.federation_operations
    SET state = sqlc.arg(state),
        response_status = sqlc.arg(response_status),
        response_ciphertext = sqlc.arg(response_ciphertext),
        payload_bytes = decode('', 'hex'),
        completed_at = now(),
        updated_at = now(),
        last_error = NULL
    WHERE operation_id = sqlc.arg(operation_id)
      AND state = 'pending'
      AND sqlc.arg(state)::vetchium.federation_operation_state IN (
          'succeeded', 'failed'
      )
    RETURNING operation_id, command_id, kind, target_authority, aggregate_id,
        owner_principal_type, owner_principal_id, idempotency_key,
        request_digest, payload_bytes, state, response_status,
        response_ciphertext, attempt_count, next_attempt_at, last_error,
        created_at, updated_at, completed_at, expires_at,
        authority_principal_type, authority_principal_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'federation.operation.resolved', 'federation_operation',
        o.operation_id::text, sqlc.arg(actor_type), sqlc.narg(actor_id),
        sqlc.arg(source), o.operation_id::text,
        jsonb_build_object('kind', o.kind, 'state', o.state, 'response_status', o.response_status)
    FROM resolved AS o
)
SELECT operation_id, command_id, kind, target_authority, aggregate_id,
    owner_principal_type, owner_principal_id, idempotency_key,
    request_digest, payload_bytes, state, response_status,
    response_ciphertext, attempt_count, next_attempt_at, last_error,
    created_at, updated_at, completed_at, expires_at,
    authority_principal_type, authority_principal_did
FROM resolved;

-- name: PruneExpiredFederationOperations :execrows
DELETE FROM vetchium.federation_operations
WHERE state IN ('succeeded', 'failed') AND expires_at <= now();

-- A command for the home tenant of an authority principal. next_attempt_at
-- starts in the future so recovery does not race the sender's first attempt.
-- name: CreateFederationCommandOperation :one
WITH created AS (
    INSERT INTO vetchium.federation_operations (
        operation_id, command_id, kind, target_authority, aggregate_id,
        owner_principal_type, owner_principal_id, idempotency_key,
        request_digest, payload_bytes, next_attempt_at, expires_at,
        authority_principal_type, authority_principal_did
    )
    VALUES (
        sqlc.arg(operation_id), sqlc.arg(command_id), sqlc.arg(kind),
        'tenant', sqlc.arg(aggregate_id),
        sqlc.arg(owner_principal_type), sqlc.arg(owner_principal_id),
        sqlc.arg(idempotency_key), sqlc.arg(request_digest),
        sqlc.arg(payload_bytes), sqlc.arg(next_attempt_at),
        sqlc.arg(expires_at), sqlc.arg(authority_principal_type),
        sqlc.arg(authority_principal_did)
    )
    RETURNING operation_id, command_id, kind, target_authority, aggregate_id,
        owner_principal_type, owner_principal_id, idempotency_key,
        request_digest, payload_bytes, state, response_status,
        response_ciphertext, attempt_count, next_attempt_at, last_error,
        created_at, updated_at, completed_at, expires_at,
        authority_principal_type, authority_principal_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'federation.operation.created', 'federation_operation',
        o.operation_id::text, o.owner_principal_type, o.owner_principal_id,
        sqlc.arg(source), o.idempotency_key,
        jsonb_build_object(
            'kind', o.kind, 'aggregate_id', o.aggregate_id,
            'command_id', o.command_id,
            'authority_principal_type', o.authority_principal_type,
            'authority_principal_did', o.authority_principal_did
        )
    FROM created AS o
)
SELECT operation_id, command_id, kind, target_authority, aggregate_id,
    owner_principal_type, owner_principal_id, idempotency_key,
    request_digest, payload_bytes, state, response_status,
    response_ciphertext, attempt_count, next_attempt_at, last_error,
    created_at, updated_at, completed_at, expires_at,
    authority_principal_type, authority_principal_did
FROM created;

-- Every tenant command kind, so no kind needs its own recovery job.
-- name: ListRecoverableFederationCommands :many
SELECT operation_id, command_id, kind, target_authority, aggregate_id,
    owner_principal_type, owner_principal_id, idempotency_key,
    request_digest, payload_bytes, state, response_status,
    response_ciphertext, attempt_count, next_attempt_at, last_error,
    created_at, updated_at, completed_at, expires_at,
    authority_principal_type, authority_principal_did
FROM vetchium.federation_operations
WHERE state = 'pending' AND target_authority = 'tenant'
  AND next_attempt_at <= now() AND expires_at > now()
ORDER BY next_attempt_at, created_at, operation_id
LIMIT sqlc.arg(batch_size);

-- An expired operation's key is free again, like any expired idempotency
-- key; a pending one is no longer driven.
-- The final SELECT's row count is the affected-row count.
-- name: DeleteExpiredFederationCommandOperation :execrows
WITH deleted AS (
    DELETE FROM vetchium.federation_operations AS operation
    WHERE operation.kind = sqlc.arg(kind)
      AND operation.aggregate_id = sqlc.arg(aggregate_id)
      AND operation.idempotency_key = sqlc.arg(idempotency_key)
      AND operation.target_authority = 'tenant'
      AND operation.expires_at <= now()
    RETURNING operation.operation_id, operation.kind, operation.state
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'federation.operation.expired',
        'federation_operation', operation_id::text, sqlc.arg(actor_type),
        sqlc.narg(actor_id), sqlc.arg(source), operation_id::text,
        jsonb_build_object('kind', kind, 'state', state)
    FROM deleted
)
SELECT operation_id FROM deleted;

-- Removes an operation whose only attempt was its sender's and was certainly
-- not sent. Every other attempt is recorded first and increments
-- attempt_count, so a zero count proves nothing else may have sent it.
-- The final SELECT's row count is the affected-row count.
-- name: AbandonUnsentFederationOperation :execrows
WITH deleted AS (
    DELETE FROM vetchium.federation_operations
    WHERE operation_id = sqlc.arg(operation_id)
      AND state = 'pending' AND target_authority = 'tenant'
      AND attempt_count = 0
    RETURNING operation_id, kind
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'federation.operation.abandoned',
        'federation_operation', operation_id::text, sqlc.arg(actor_type),
        sqlc.narg(actor_id), sqlc.arg(source), operation_id::text,
        jsonb_build_object('kind', kind)
    FROM deleted
)
SELECT operation_id FROM deleted;

-- name: GetOrgFederationOperationStatus :one
SELECT operation_id, state
FROM vetchium.federation_operations
WHERE operation_id = sqlc.arg(operation_id)
  AND owner_principal_type = 'org_user'
  AND owner_principal_id = sqlc.arg(owner_principal_id)
  AND expires_at > now();

-- A principal row in this database means this tenant is its home.
-- name: IsLocalFederationPrincipal :one
SELECT CASE sqlc.arg(principal_type)::text
    WHEN 'hub_user' THEN EXISTS (
        SELECT 1 FROM vetchium.hub_users
        WHERE hub_user_did = sqlc.arg(principal_did)
    )
    WHEN 'org' THEN EXISTS (
        SELECT 1 FROM vetchium.orgs WHERE org_did = sqlc.arg(principal_did)
    )
    ELSE false
END::boolean AS is_local;

-- name: GetFederationCommandResult :one
SELECT command_id, source_tenant_id, kind, aggregate_id, request_digest,
    response_status, response_body, completed_at
FROM vetchium.federation_command_ledger
WHERE command_id = sqlc.arg(command_id);

-- name: RecordFederationCommandResult :one
INSERT INTO vetchium.federation_command_ledger (
    command_id, source_tenant_id, kind, aggregate_id, request_digest,
    response_status, response_body
)
VALUES (
    sqlc.arg(command_id), sqlc.arg(source_tenant_id), sqlc.arg(kind),
    sqlc.arg(aggregate_id), sqlc.arg(request_digest),
    sqlc.arg(response_status), sqlc.arg(response_body)
)
ON CONFLICT (command_id) DO UPDATE
SET command_id = vetchium.federation_command_ledger.command_id
WHERE vetchium.federation_command_ledger.source_tenant_id =
        EXCLUDED.source_tenant_id
  AND vetchium.federation_command_ledger.kind = EXCLUDED.kind
  AND vetchium.federation_command_ledger.aggregate_id = EXCLUDED.aggregate_id
  AND vetchium.federation_command_ledger.request_digest =
        EXCLUDED.request_digest
  AND vetchium.federation_command_ledger.response_status =
        EXCLUDED.response_status
  AND vetchium.federation_command_ledger.response_body =
        EXCLUDED.response_body
RETURNING command_id, source_tenant_id, kind, aggregate_id, request_digest,
    response_status, response_body, completed_at;

-- Runs only inside the write transaction whose own audit event covers the
-- change the event reports.
-- name: CreateFederationOutboxEvent :exec
INSERT INTO vetchium.federation_outbox (
    event_id, kind, destination_principal_type, destination_principal_did,
    aggregate_type, aggregate_id, aggregate_version, payload_bytes
)
VALUES (
    sqlc.arg(event_id), sqlc.arg(kind), sqlc.arg(destination_principal_type),
    sqlc.arg(destination_principal_did), sqlc.arg(aggregate_type),
    sqlc.arg(aggregate_id), sqlc.arg(aggregate_version),
    sqlc.arg(payload_bytes)
);

-- Enqueues several events in one statement. The arrays have equal lengths;
-- set-returning functions in one select list advance together.
-- name: CreateFederationOutboxEvents :execrows
INSERT INTO vetchium.federation_outbox (
    event_id, kind, destination_principal_type, destination_principal_did,
    aggregate_type, aggregate_id, aggregate_version, payload_bytes
)
SELECT unnest(sqlc.arg(event_ids)::uuid[]),
    unnest(sqlc.arg(kinds)::text[]),
    unnest(sqlc.arg(destination_principal_types)::text[]),
    unnest(sqlc.arg(destination_principal_dids)::uuid[]),
    unnest(sqlc.arg(aggregate_types)::text[]),
    unnest(sqlc.arg(aggregate_ids)::text[]),
    unnest(sqlc.arg(aggregate_versions)::bigint[]),
    unnest(sqlc.arg(payloads)::bytea[]);

-- name: ClaimFederationOutboxEvent :one
WITH candidate AS (
    SELECT event_id
    FROM vetchium.federation_outbox
    WHERE delivered_at IS NULL AND failed_at IS NULL
      AND next_attempt_at <= now()
      AND (leased_until IS NULL OR leased_until <= now())
    ORDER BY next_attempt_at, created_at, event_id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
), claimed AS (
    UPDATE vetchium.federation_outbox AS event
    SET lease_token = sqlc.arg(lease_token),
        leased_until = sqlc.arg(leased_until),
        attempt_count = attempt_count + 1
    WHERE event.event_id = (SELECT event_id FROM candidate)
    RETURNING event.event_id, event.kind, event.destination_principal_type,
        event.destination_principal_did, event.aggregate_type,
        event.aggregate_id, event.aggregate_version, event.payload_bytes,
        event.attempt_count, event.created_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'federation.event.delivery-claimed',
        'federation_event', event_id::text, 'worker', 'federation-events',
        'workers', event_id::text,
        jsonb_build_object('kind', kind, 'attempt', attempt_count)
    FROM claimed
)
SELECT event_id, kind, destination_principal_type, destination_principal_did,
    aggregate_type, aggregate_id, aggregate_version, payload_bytes,
    attempt_count, created_at
FROM claimed;

-- The final SELECT's row count is the affected-row count.
-- name: CompleteFederationOutboxEvent :execrows
WITH completed AS (
    UPDATE vetchium.federation_outbox
    SET delivered_at = now(), lease_token = NULL, leased_until = NULL,
        last_error = NULL
    WHERE event_id = sqlc.arg(event_id)
      AND lease_token = sqlc.arg(lease_token)
      AND delivered_at IS NULL AND failed_at IS NULL
    RETURNING event_id, kind, attempt_count
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'federation.event.delivered',
        'federation_event', event_id::text, 'worker', 'federation-events',
        'workers', event_id::text,
        jsonb_build_object(
            'kind', kind, 'attempt', attempt_count,
            'outcome', sqlc.arg(outcome)::text
        )
    FROM completed
)
SELECT event_id FROM completed;

-- The final SELECT's row count is the affected-row count.
-- name: RetryFederationOutboxEvent :execrows
WITH retried AS (
    UPDATE vetchium.federation_outbox
    SET lease_token = NULL, leased_until = NULL,
        next_attempt_at = now() + LEAST(
            interval '5 minutes',
            interval '1 second' * power(2, LEAST(attempt_count, 8))
        ),
        last_error = left(sqlc.arg(last_error), 200)
    WHERE event_id = sqlc.arg(event_id)
      AND lease_token = sqlc.arg(lease_token)
      AND delivered_at IS NULL AND failed_at IS NULL
    RETURNING event_id, kind, attempt_count
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'federation.event.retry-scheduled',
        'federation_event', event_id::text, 'worker', 'federation-events',
        'workers', event_id::text,
        jsonb_build_object('kind', kind, 'attempt', attempt_count)
    FROM retried
)
SELECT event_id FROM retried;

-- The final SELECT's row count is the affected-row count.
-- name: FailFederationOutboxEvent :execrows
WITH failed AS (
    UPDATE vetchium.federation_outbox
    SET failed_at = now(), lease_token = NULL, leased_until = NULL,
        last_error = left(sqlc.arg(last_error), 200)
    WHERE event_id = sqlc.arg(event_id)
      AND lease_token = sqlc.arg(lease_token)
      AND delivered_at IS NULL AND failed_at IS NULL
    RETURNING event_id, kind, attempt_count
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'federation.event.delivery-failed',
        'federation_event', event_id::text, 'worker', 'federation-events',
        'workers', event_id::text,
        jsonb_build_object(
            'kind', kind, 'attempt', attempt_count,
            'reason', sqlc.arg(last_error)::text
        )
    FROM failed
)
SELECT event_id FROM failed;

-- name: GetFederationInboxReceipt :one
SELECT event_id, source_tenant_id, kind, aggregate_type, aggregate_id,
    aggregate_version, payload_digest, applied, received_at
FROM vetchium.federation_inbox
WHERE event_id = sqlc.arg(event_id);

-- Returns a row only when the event is newer than every version of its
-- aggregate already applied for this kind and destination.
-- name: AdvanceFederationEventWatermark :one
INSERT INTO vetchium.federation_event_watermarks AS watermark (
    kind, destination_principal_did, aggregate_type, aggregate_id,
    aggregate_version
)
VALUES (
    sqlc.arg(kind), sqlc.arg(destination_principal_did),
    sqlc.arg(aggregate_type), sqlc.arg(aggregate_id),
    sqlc.arg(aggregate_version)
)
ON CONFLICT (kind, destination_principal_did, aggregate_type, aggregate_id)
DO UPDATE SET aggregate_version = EXCLUDED.aggregate_version,
    updated_at = now()
WHERE watermark.aggregate_version < EXCLUDED.aggregate_version
RETURNING aggregate_version;

-- name: RecordFederationInboxReceipt :exec
WITH received AS (
    INSERT INTO vetchium.federation_inbox (
        event_id, source_tenant_id, kind, aggregate_type, aggregate_id,
        aggregate_version, payload_digest, applied
    )
    VALUES (
        sqlc.arg(event_id), sqlc.arg(source_tenant_id), sqlc.arg(kind),
        sqlc.arg(aggregate_type), sqlc.arg(aggregate_id),
        sqlc.arg(aggregate_version), sqlc.arg(payload_digest),
        sqlc.arg(applied)
    )
    RETURNING event_id, source_tenant_id, kind, aggregate_type, aggregate_id,
        aggregate_version, applied
)
INSERT INTO vetchium.audit_events (
    tenant_id, action, entity_type, entity_id, actor_type, actor_id,
    source, idempotency_key, payload
)
SELECT sqlc.arg(tenant_id), 'federation.event.received', 'federation_event',
    event_id::text, 'tenant', source_tenant_id, sqlc.arg(source),
    event_id::text,
    jsonb_build_object(
        'kind', kind, 'aggregate_type', aggregate_type,
        'aggregate_id', aggregate_id, 'aggregate_version', aggregate_version,
        'applied', applied
    )
FROM received;

-- name: ApplyHubProfileAlias :one
WITH previous AS (
    SELECT u.hub_user_did, u.profile_alias, u.alias_last_changed_at
    FROM vetchium.hub_users AS u
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
      AND u.hub_plan_oid <> 'hub-free-tier'
      AND u.profile_alias IS NOT DISTINCT FROM
          sqlc.narg(previous_alias)::text
      AND (u.profile_version = sqlc.arg(expected_profile_version)
           OR sqlc.narg(profile_alias)::text IS NULL)
    FOR UPDATE
), updated AS (
    UPDATE vetchium.hub_users AS u
    SET profile_alias = sqlc.narg(profile_alias),
        alias_last_changed_at = now(),
        profile_version = profile_version + 1,
        updated_at = now()
    FROM previous
    WHERE u.hub_user_did = previous.hub_user_did
      AND u.profile_alias IS DISTINCT FROM sqlc.narg(profile_alias)
    RETURNING u.hub_user_did, u.profile_alias, u.alias_last_changed_at,
        u.profile_version, previous.profile_alias AS previous_alias
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.alias-changed', 'hub_user',
        hub_user_did::text, 'hub_user', hub_user_did::text, 'hub-api',
        sqlc.arg(idempotency_key), jsonb_build_object(
            'schema_version', 1, 'previous_alias', previous_alias,
            'alias', profile_alias,
            'profile_version', profile_version
        )
    FROM updated
)
SELECT hub_user_did, profile_alias, alias_last_changed_at, profile_version
FROM updated;

-- name: GetHubAliasMutationState :one
SELECT u.hub_plan_oid, u.profile_alias, u.alias_last_changed_at,
    u.profile_version,
    EXISTS (
        SELECT 1 FROM vetchium.federation_operations AS operation
        WHERE operation.kind = 'hub-alias-change'
          AND operation.aggregate_id = u.hub_user_did::text
          AND operation.state = 'pending'
    ) AS has_pending_change
FROM vetchium.hub_users AS u
JOIN vetchium.hub_sessions AS session USING (hub_user_did)
WHERE u.hub_user_did = sqlc.arg(hub_user_did)
  AND session.hub_session_id = sqlc.arg(hub_session_id)
  AND session.expires_at > now()
  AND u.hub_user_state = 'active'
FOR UPDATE OF u;

-- name: HubAliasOperationPreflight :one
SELECT EXISTS (
    SELECT 1 FROM vetchium.hub_users
    WHERE hub_user_did = sqlc.arg(hub_user_did)
      AND hub_user_state = 'active'
      AND hub_plan_oid <> 'hub-free-tier'
      AND profile_version = sqlc.arg(expected_profile_version)
) AS may_dispatch;

-- name: ListRecoverableHubAliasChanges :many
SELECT operation_id, command_id, kind, target_authority, aggregate_id,
    owner_principal_type, owner_principal_id, idempotency_key,
    request_digest, payload_bytes, state, response_status,
    response_ciphertext, attempt_count, next_attempt_at, last_error,
    created_at, updated_at, completed_at, expires_at,
    authority_principal_type, authority_principal_did
FROM vetchium.federation_operations
WHERE kind = 'hub-alias-change'
  AND state = 'pending' AND next_attempt_at <= now()
ORDER BY next_attempt_at, created_at, operation_id
LIMIT sqlc.arg(batch_size);
