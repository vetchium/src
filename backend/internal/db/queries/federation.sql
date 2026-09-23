-- name: CreateFederationOperation :one
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
    created_at, updated_at, completed_at, expires_at;

-- name: GetFederationOperation :one
SELECT operation_id, command_id, kind, target_authority, aggregate_id,
    owner_principal_type, owner_principal_id, idempotency_key,
    request_digest, payload_bytes, state, response_status,
    response_ciphertext, attempt_count, next_attempt_at, last_error,
    created_at, updated_at, completed_at, expires_at
FROM vetchium.federation_operations
WHERE operation_id = sqlc.arg(operation_id)
  AND expires_at > now();

-- name: GetFederationOperationByIdempotency :one
SELECT operation_id, command_id, kind, target_authority, aggregate_id,
    owner_principal_type, owner_principal_id, idempotency_key,
    request_digest, payload_bytes, state, response_status,
    response_ciphertext, attempt_count, next_attempt_at, last_error,
    created_at, updated_at, completed_at, expires_at
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
    created_at, updated_at, completed_at, expires_at
FROM vetchium.federation_operations
WHERE state = 'pending' AND next_attempt_at <= now()
ORDER BY next_attempt_at, created_at, operation_id
LIMIT sqlc.arg(batch_size);

-- name: ListRecoverableHubAliasReleases :many
SELECT operation_id, command_id, kind, target_authority, aggregate_id,
    owner_principal_type, owner_principal_id, idempotency_key,
    request_digest, payload_bytes, state, response_status,
    response_ciphertext, attempt_count, next_attempt_at, last_error,
    created_at, updated_at, completed_at, expires_at
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

-- name: RecordFederationOperationRetry :execrows
UPDATE vetchium.federation_operations
SET attempt_count = attempt_count + 1,
    next_attempt_at = now() + LEAST(
        interval '5 minutes',
        interval '1 second' * power(2, LEAST(attempt_count, 8))
    ),
    last_error = left(sqlc.arg(last_error), 200),
    updated_at = now()
WHERE operation_id = sqlc.arg(operation_id) AND state = 'pending';

-- name: ResolveFederationOperation :one
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
    created_at, updated_at, completed_at, expires_at;

-- name: PruneExpiredFederationOperations :execrows
DELETE FROM vetchium.federation_operations
WHERE state IN ('succeeded', 'failed') AND expires_at <= now();

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

-- name: CreateFederationOutboxEvent :one
INSERT INTO vetchium.federation_outbox (
    event_id, destination_tenant_id, kind, aggregate_type, aggregate_id,
    aggregate_version, payload, payload_digest
)
VALUES (
    sqlc.arg(event_id), sqlc.arg(destination_tenant_id), sqlc.arg(kind),
    sqlc.arg(aggregate_type), sqlc.arg(aggregate_id),
    sqlc.arg(aggregate_version), sqlc.arg(payload), sqlc.arg(payload_digest)
)
RETURNING event_id, destination_tenant_id, kind, aggregate_type,
    aggregate_id, aggregate_version, payload, payload_digest, attempt_count,
    next_attempt_at, lease_token, leased_until, created_at, delivered_at,
    failed_at, last_error;

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
        leased_until = now() + interval '1 minute',
        attempt_count = attempt_count + 1
    WHERE event.event_id = (SELECT event_id FROM candidate)
    RETURNING event.event_id, event.destination_tenant_id, event.kind,
        event.aggregate_type, event.aggregate_id, event.aggregate_version,
        event.payload, event.payload_digest, event.attempt_count,
        event.next_attempt_at, event.lease_token, event.leased_until,
        event.created_at, event.delivered_at, event.failed_at,
        event.last_error
)
SELECT event_id, destination_tenant_id, kind, aggregate_type, aggregate_id,
    aggregate_version, payload, payload_digest, attempt_count,
    next_attempt_at, lease_token, leased_until, created_at, delivered_at,
    failed_at, last_error
FROM claimed;

-- name: CompleteFederationOutboxEvent :execrows
UPDATE vetchium.federation_outbox
SET delivered_at = now(), lease_token = NULL, leased_until = NULL,
    last_error = NULL
WHERE event_id = sqlc.arg(event_id)
  AND lease_token = sqlc.arg(lease_token)
  AND delivered_at IS NULL AND failed_at IS NULL;

-- name: RetryFederationOutboxEvent :execrows
UPDATE vetchium.federation_outbox
SET lease_token = NULL, leased_until = NULL,
    next_attempt_at = now() + LEAST(
        interval '5 minutes',
        interval '1 second' * power(2, LEAST(attempt_count, 8))
    ),
    last_error = left(sqlc.arg(last_error), 200)
WHERE event_id = sqlc.arg(event_id)
  AND lease_token = sqlc.arg(lease_token)
  AND delivered_at IS NULL AND failed_at IS NULL;

-- name: RecordFederationInboxReceipt :one
INSERT INTO vetchium.federation_inbox (
    event_id, source_tenant_id, kind, aggregate_type, aggregate_id,
    aggregate_version, payload_digest
)
VALUES (
    sqlc.arg(event_id), sqlc.arg(source_tenant_id), sqlc.arg(kind),
    sqlc.arg(aggregate_type), sqlc.arg(aggregate_id),
    sqlc.arg(aggregate_version), sqlc.arg(payload_digest)
)
ON CONFLICT (event_id) DO UPDATE
SET event_id = vetchium.federation_inbox.event_id
WHERE vetchium.federation_inbox.source_tenant_id = EXCLUDED.source_tenant_id
  AND vetchium.federation_inbox.kind = EXCLUDED.kind
  AND vetchium.federation_inbox.aggregate_type = EXCLUDED.aggregate_type
  AND vetchium.federation_inbox.aggregate_id = EXCLUDED.aggregate_id
  AND vetchium.federation_inbox.aggregate_version = EXCLUDED.aggregate_version
  AND vetchium.federation_inbox.payload_digest = EXCLUDED.payload_digest
RETURNING event_id, source_tenant_id, kind, aggregate_type, aggregate_id,
    aggregate_version, payload_digest, received_at, applied_at;

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
    created_at, updated_at, completed_at, expires_at
FROM vetchium.federation_operations
WHERE kind = 'hub-alias-change'
  AND state = 'pending' AND next_attempt_at <= now()
ORDER BY next_attempt_at, created_at, operation_id
LIMIT sqlc.arg(batch_size);
