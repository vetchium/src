-- name: CreateHubSignupRequest :one
WITH allowed_domain AS (
    SELECT 1
    FROM vetchium.hub_signup_domains
    WHERE domain = sqlc.arg(email_domain)
      AND hub_signup_domain_state = 'active'
), existing_user AS (
    SELECT 1
    FROM vetchium.hub_users AS u
    WHERE u.email_address = sqlc.arg(email_address)
), upserted AS (
    INSERT INTO vetchium.hub_signup_requests (
        hub_signup_request_id,
        email_address,
        display_name,
        preferred_language,
        resident_country,
        token_hash,
        expires_at
    )
    SELECT
        sqlc.arg(hub_signup_request_id),
        sqlc.arg(email_address),
        sqlc.arg(display_name),
        sqlc.arg(preferred_language),
        sqlc.arg(resident_country),
        sqlc.arg(token_hash),
        sqlc.arg(expires_at)
    WHERE EXISTS (SELECT 1 FROM allowed_domain)
      AND NOT EXISTS (SELECT 1 FROM existing_user)
      AND sqlc.narg(registered_elsewhere_tenant_id)::text IS NULL
    -- A request whose token already started a completion stays with that
    -- completion until it completes, fails, or is abandoned, each of which
    -- deactivates it. Replacing it would strand the completion's global
    -- reservation. The condition is on the conflicting row itself, so a
    -- concurrent PrepareHubSignupCompletion that holds the row is waited for
    -- and its consumed_at is seen.
    ON CONFLICT (email_address) WHERE active DO UPDATE
    SET hub_signup_request_id = EXCLUDED.hub_signup_request_id,
        display_name = EXCLUDED.display_name,
        preferred_language = EXCLUDED.preferred_language,
        resident_country = EXCLUDED.resident_country,
        token_hash = EXCLUDED.token_hash,
        created_at = now(),
        expires_at = EXCLUDED.expires_at
    WHERE hub_signup_requests.consumed_at IS NULL
    RETURNING hub_signup_request_id
), outbox AS (
    INSERT INTO vetchium.hub_email_outbox (
        kind,
        recipient_email_address,
        preferred_language,
        payload_ciphertext
    )
    SELECT
        'signup',
        sqlc.arg(email_address),
        sqlc.arg(preferred_language),
        sqlc.arg(payload_ciphertext)
    FROM upserted
    RETURNING hub_email_outbox_id
-- The address is registered at another tenant (GU-SIG-002): no signup
-- request is created here, so the response cannot distinguish this from an
-- unregistered address, and the mailed notice names the home region instead
-- of carrying a signup link.
), elsewhere_outbox AS (
    INSERT INTO vetchium.hub_email_outbox (
        kind,
        recipient_email_address,
        preferred_language,
        payload_ciphertext
    )
    SELECT
        'signup-registered-elsewhere',
        sqlc.arg(email_address),
        sqlc.arg(preferred_language),
        sqlc.arg(elsewhere_payload_ciphertext)
    WHERE EXISTS (SELECT 1 FROM allowed_domain)
      AND NOT EXISTS (SELECT 1 FROM existing_user)
      AND sqlc.narg(registered_elsewhere_tenant_id)::text IS NOT NULL
    RETURNING hub_email_outbox_id
), elsewhere_audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id,
        action,
        entity_type,
        entity_id,
        actor_type,
        source,
        idempotency_key,
        payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.signup.rejected',
        'hub_signup_request',
        sqlc.arg(hub_signup_request_id)::text,
        'anonymous',
        'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object(
            'reason', 'email_registered_elsewhere',
            'home_tenant_id', sqlc.narg(registered_elsewhere_tenant_id)::text,
            'resident_country', sqlc.arg(resident_country)::text
        )
    WHERE EXISTS (SELECT 1 FROM allowed_domain)
      AND NOT EXISTS (SELECT 1 FROM existing_user)
      AND sqlc.narg(registered_elsewhere_tenant_id)::text IS NOT NULL
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id,
        action,
        entity_type,
        entity_id,
        actor_type,
        source,
        idempotency_key,
        payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.signup.requested',
        'hub_signup_request',
        hub_signup_request_id::text,
        'anonymous',
        'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object(
            'preferred_language', sqlc.arg(preferred_language)::text,
            'resident_country', sqlc.arg(resident_country)::text,
            'email_queued', EXISTS (SELECT 1 FROM outbox)
        )
    FROM upserted
),
-- An attempt on an address that already has an account is answered with the
-- same 202 as a fresh request, so that the response cannot be used to test
-- whether an address is registered. This event is the only record that it
-- happened, and repeated rows are what makes probing visible to an operator.
existing_account_audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id,
        action,
        entity_type,
        entity_id,
        actor_type,
        source,
        idempotency_key,
        payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.signup.rejected',
        'hub_signup_request',
        sqlc.arg(hub_signup_request_id)::text,
        'anonymous',
        'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object(
            'reason', 'email_already_registered',
            'resident_country', sqlc.arg(resident_country)::text
        )
    WHERE EXISTS (SELECT 1 FROM allowed_domain)
      AND EXISTS (SELECT 1 FROM existing_user)
), completion_in_progress_audit AS (
    -- Answered with the same generic 202 as every other outcome.
    INSERT INTO vetchium.audit_events (
        tenant_id,
        action,
        entity_type,
        entity_id,
        actor_type,
        source,
        idempotency_key,
        payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.signup.rejected',
        'hub_signup_request',
        sqlc.arg(hub_signup_request_id)::text,
        'anonymous',
        'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object(
            'reason', 'signup_completion_in_progress',
            'resident_country', sqlc.arg(resident_country)::text
        )
    WHERE EXISTS (SELECT 1 FROM allowed_domain)
      AND NOT EXISTS (SELECT 1 FROM existing_user)
      AND sqlc.narg(registered_elsewhere_tenant_id)::text IS NULL
      AND NOT EXISTS (SELECT 1 FROM upserted)
)
SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM allowed_domain) THEN 'domain_not_allowed'
    ELSE 'accepted'
END::text AS result;

-- name: ResolveHubSignupForCompletion :one
SELECT
    hub_signup_request_id,
    email_address,
    display_name,
    preferred_language,
    resident_country
FROM vetchium.hub_signup_requests
WHERE token_hash = sqlc.arg(token_hash)
  AND active
  AND consumed_at IS NULL
  AND expires_at > now()
FOR UPDATE;

-- name: FindHubSignupForCompletion :one
SELECT
    hub_signup_request_id,
    email_address,
    display_name,
    preferred_language,
    resident_country
FROM vetchium.hub_signup_requests
WHERE token_hash = sqlc.arg(token_hash)
  AND active
  AND consumed_at IS NULL
  AND expires_at > now();

-- name: GetHubSignupCompletionByTokenHash :one
SELECT
    operation_id,
    hub_signup_request_id,
    token_hash,
    idempotency_key,
    request_digest,
    account_email_digest,
    hub_user_did,
    handle,
    reserve_command_id,
    activate_command_id,
    payload_ciphertext,
    state,
    failure_reason,
    conflicting_home_tenant_id,
    provisioning_expires_at,
    attempt_count,
    next_attempt_at,
    last_error,
    created_at,
    updated_at,
    completed_at,
    expires_at
FROM vetchium.hub_signup_completions
WHERE token_hash = sqlc.arg(token_hash)
  AND expires_at > now();

-- name: GetHubSignupCompletion :one
SELECT
    operation_id,
    hub_signup_request_id,
    token_hash,
    idempotency_key,
    request_digest,
    account_email_digest,
    hub_user_did,
    handle,
    reserve_command_id,
    activate_command_id,
    payload_ciphertext,
    state,
    failure_reason,
    conflicting_home_tenant_id,
    provisioning_expires_at,
    attempt_count,
    next_attempt_at,
    last_error,
    created_at,
    updated_at,
    completed_at,
    expires_at
FROM vetchium.hub_signup_completions
WHERE operation_id = sqlc.arg(operation_id)
  AND expires_at > now();

-- name: PrepareHubSignupCompletion :one
WITH eligible_signup AS (
    SELECT s.hub_signup_request_id
    FROM vetchium.hub_signup_requests AS s
    WHERE s.hub_signup_request_id = sqlc.arg(hub_signup_request_id)
      AND s.token_hash = sqlc.arg(token_hash)
      AND s.active
      AND s.consumed_at IS NULL
      AND s.expires_at > now()
      AND EXISTS (
          SELECT 1 FROM vetchium.hub_signup_domains AS d
          WHERE d.domain = split_part(s.email_address, '@', 2)
            AND d.hub_signup_domain_state = 'active'
      )
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.hub_users AS u
          WHERE u.email_address = s.email_address
      )
    FOR UPDATE
), inserted AS (
    INSERT INTO vetchium.hub_signup_completions (
        operation_id,
        hub_signup_request_id,
        token_hash,
        idempotency_key,
        request_digest,
        account_email_digest,
        hub_user_did,
        handle,
        reserve_command_id,
        activate_command_id,
        payload_ciphertext,
        provisioning_expires_at,
        expires_at
    )
    SELECT
        sqlc.arg(operation_id),
        hub_signup_request_id,
        sqlc.arg(token_hash),
        sqlc.arg(idempotency_key),
        sqlc.arg(request_digest),
        sqlc.arg(account_email_digest),
        sqlc.arg(hub_user_did),
        sqlc.arg(handle),
        sqlc.arg(reserve_command_id),
        sqlc.arg(activate_command_id),
        sqlc.arg(payload_ciphertext),
        sqlc.arg(provisioning_expires_at),
        sqlc.arg(expires_at)
    FROM eligible_signup
    ON CONFLICT DO NOTHING
    RETURNING *
), consumed_request AS (
    -- The token is spent once a completion owns it; the request stays
    -- active, holding the address against replacement, until the completion
    -- ends.
    UPDATE vetchium.hub_signup_requests
    SET consumed_at = now()
    WHERE hub_signup_request_id IN (
        SELECT hub_signup_request_id FROM inserted
    )
    RETURNING hub_signup_request_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, source,
        idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.signup.completion_prepared',
        'hub_signup_completion',
        operation_id::text,
        'anonymous',
        'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object(
            'hub_user_did', hub_user_did,
            'handle', handle
        )
    FROM inserted
)
SELECT * FROM inserted;

-- name: RotateHubSignupCompletionHandle :one
WITH updated AS (
    UPDATE vetchium.hub_signup_completions
    SET handle = sqlc.arg(handle),
        reserve_command_id = sqlc.arg(new_reserve_command_id),
        attempt_count = attempt_count + 1,
        updated_at = now(),
        next_attempt_at = now(),
        last_error = 'global_handle_conflict'
    WHERE operation_id = sqlc.arg(operation_id)
      AND state = 'prepared'
      AND reserve_command_id = sqlc.arg(previous_reserve_command_id)
    RETURNING *
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, source,
        idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.signup.completion_handle_rotated',
        'hub_signup_completion',
        operation_id::text,
        'system',
        sqlc.arg(source),
        idempotency_key,
        jsonb_build_object('hub_user_did', hub_user_did, 'handle', handle)
    FROM updated
)
SELECT
    operation_id,
    hub_signup_request_id,
    token_hash,
    idempotency_key,
    request_digest,
    account_email_digest,
    hub_user_did,
    handle,
    reserve_command_id,
    activate_command_id,
    payload_ciphertext,
    state,
    failure_reason,
    conflicting_home_tenant_id,
    provisioning_expires_at,
    attempt_count,
    next_attempt_at,
    last_error,
    created_at,
    updated_at,
    completed_at,
    expires_at
FROM updated;

-- name: MarkHubSignupCompletionReserved :one
WITH updated AS (
    UPDATE vetchium.hub_signup_completions
    SET state = 'reserved',
        attempt_count = attempt_count + 1,
        updated_at = now(),
        next_attempt_at = now(),
        last_error = NULL
    WHERE operation_id = sqlc.arg(operation_id)
      AND state = 'prepared'
      AND reserve_command_id = sqlc.arg(reserve_command_id)
    RETURNING *
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, source,
        idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.signup.completion_reserved',
        'hub_signup_completion',
        operation_id::text,
        'system',
        sqlc.arg(source),
        idempotency_key,
        jsonb_build_object('hub_user_did', hub_user_did, 'handle', handle)
    FROM updated
)
SELECT
    operation_id,
    hub_signup_request_id,
    token_hash,
    idempotency_key,
    request_digest,
    account_email_digest,
    hub_user_did,
    handle,
    reserve_command_id,
    activate_command_id,
    payload_ciphertext,
    state,
    failure_reason,
    conflicting_home_tenant_id,
    provisioning_expires_at,
    attempt_count,
    next_attempt_at,
    last_error,
    created_at,
    updated_at,
    completed_at,
    expires_at
FROM updated;

-- name: RecordHubSignupCompletionRetry :exec
WITH updated AS (
    UPDATE vetchium.hub_signup_completions
    SET attempt_count = attempt_count + 1,
        updated_at = now(),
        next_attempt_at = now() + LEAST(
            interval '5 minutes',
            interval '1 second' * power(2, LEAST(attempt_count, 8))
        ),
        last_error = left(sqlc.arg(last_error), 200)
    WHERE operation_id = sqlc.arg(operation_id)
      AND state <> 'completed'
    RETURNING operation_id, idempotency_key, attempt_count, next_attempt_at
)
INSERT INTO vetchium.audit_events (
    tenant_id, action, entity_type, entity_id, actor_type, source,
    idempotency_key, payload
)
SELECT
    sqlc.arg(tenant_id),
    'hub.signup.completion_retry_scheduled',
    'hub_signup_completion',
    operation_id::text,
    'system',
    sqlc.arg(source),
    idempotency_key,
    jsonb_build_object(
        'attempt_count', attempt_count,
        'next_attempt_at', next_attempt_at
    )
FROM updated;

-- name: CreateProvisioningHubUser :one
WITH locked_operation AS (
    SELECT operation.*
    FROM vetchium.hub_signup_completions AS operation
    WHERE operation.operation_id = sqlc.arg(operation_id)
      AND operation.state = 'reserved'
    FOR UPDATE
), locked_request AS (
    SELECT request.hub_signup_request_id
    FROM vetchium.hub_signup_requests AS request
    WHERE request.hub_signup_request_id = (
        SELECT hub_signup_request_id FROM locked_operation
    )
      AND request.active
    FOR UPDATE
), inserted_user AS (
    INSERT INTO vetchium.hub_users (
        hub_user_did,
        handle,
        email_address,
        email_digest,
        display_name,
        password_hash,
        hub_user_state,
        preferred_language,
        resident_country,
        preferred_job_countries,
        hub_plan_oid
    )
    SELECT
        hub_user_did,
        handle,
        sqlc.arg(email_address),
        account_email_digest,
        sqlc.arg(display_name),
        sqlc.arg(password_hash),
        'provisioning',
        sqlc.arg(preferred_language),
        sqlc.arg(resident_country),
        ARRAY[sqlc.arg(resident_country)]::text[],
        sqlc.arg(default_hub_plan_oid)
    FROM locked_operation
    WHERE EXISTS (SELECT 1 FROM locked_request)
    RETURNING hub_user_did
), consumed AS (
    UPDATE vetchium.hub_signup_requests
    SET active = false
    WHERE hub_signup_request_id IN (
        SELECT hub_signup_request_id FROM locked_request
    )
      AND EXISTS (SELECT 1 FROM inserted_user)
    RETURNING hub_signup_request_id
), updated AS (
    UPDATE vetchium.hub_signup_completions AS operation
    SET state = 'local_created',
        updated_at = now(),
        next_attempt_at = now(),
        last_error = NULL
    WHERE operation.operation_id = sqlc.arg(operation_id)
      AND EXISTS (SELECT 1 FROM consumed)
    RETURNING *
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, source,
        idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.user.provisioning',
        'hub_user',
        hub_user_did::text,
        'anonymous',
        sqlc.arg(source),
        idempotency_key,
        jsonb_build_object('handle', handle, 'operation_id', operation_id)
    FROM updated
)
SELECT
    operation_id,
    hub_signup_request_id,
    token_hash,
    idempotency_key,
    request_digest,
    account_email_digest,
    hub_user_did,
    handle,
    reserve_command_id,
    activate_command_id,
    payload_ciphertext,
    state,
    failure_reason,
    conflicting_home_tenant_id,
    provisioning_expires_at,
    attempt_count,
    next_attempt_at,
    last_error,
    created_at,
    updated_at,
    completed_at,
    expires_at
FROM updated;

-- name: CompleteProvisioningHubUser :one
WITH locked_operation AS (
    SELECT operation.*
    FROM vetchium.hub_signup_completions AS operation
    WHERE operation.operation_id = sqlc.arg(operation_id)
      AND operation.state = 'local_created'
    FOR UPDATE
), activated_user AS (
    UPDATE vetchium.hub_users AS u
    SET hub_user_state = 'active', updated_at = now()
    FROM locked_operation AS operation
    WHERE u.hub_user_did = operation.hub_user_did
      AND u.hub_user_state = 'provisioning'
    RETURNING u.hub_user_did, u.handle, u.hub_plan_oid
), updated AS (
    UPDATE vetchium.hub_signup_completions AS operation
    SET state = 'completed',
        completed_at = now(),
        updated_at = now(),
        next_attempt_at = now(),
        last_error = NULL,
        payload_ciphertext = '\\x'::bytea
    WHERE operation.operation_id = sqlc.arg(operation_id)
      AND EXISTS (SELECT 1 FROM activated_user)
    RETURNING *
), user_audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, source,
        idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.user.created',
        'hub_user',
        user_row.hub_user_did::text,
        'anonymous',
        sqlc.arg(source),
        operation.idempotency_key,
        jsonb_build_object('handle', user_row.handle)
    FROM activated_user AS user_row
    CROSS JOIN updated AS operation
), subscription_audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, source,
        idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.subscription.created',
        'hub_subscription',
        user_row.hub_user_did::text,
        'anonymous',
        sqlc.arg(source),
        operation.idempotency_key,
        jsonb_build_object('hub_plan_oid', user_row.hub_plan_oid)
    FROM activated_user AS user_row
    CROSS JOIN updated AS operation
)
SELECT
    operation_id,
    hub_signup_request_id,
    token_hash,
    idempotency_key,
    request_digest,
    account_email_digest,
    hub_user_did,
    handle,
    reserve_command_id,
    activate_command_id,
    payload_ciphertext,
    state,
    failure_reason,
    conflicting_home_tenant_id,
    provisioning_expires_at,
    attempt_count,
    next_attempt_at,
    last_error,
    created_at,
    updated_at,
    completed_at,
    expires_at
FROM updated;

-- name: AbandonExpiredHubSignupCompletion :one
WITH locked_operation AS (
    SELECT operation.*
    FROM vetchium.hub_signup_completions AS operation
    WHERE operation.operation_id = sqlc.arg(operation_id)
      AND operation.state NOT IN ('completed', 'failed')
      AND operation.provisioning_expires_at <= now()
    FOR UPDATE
), deleted_user AS (
    DELETE FROM vetchium.hub_users AS hub_user
    USING locked_operation AS operation
    WHERE hub_user.hub_user_did = operation.hub_user_did
      AND hub_user.hub_user_state = 'provisioning'
    RETURNING hub_user.hub_user_did
), released_request AS (
    UPDATE vetchium.hub_signup_requests AS request
    SET active = false
    FROM locked_operation AS operation
    WHERE request.hub_signup_request_id = operation.hub_signup_request_id
    RETURNING request.hub_signup_request_id
), updated AS (
    UPDATE vetchium.hub_signup_completions AS operation
    SET state = 'failed',
        failure_reason = 'expired',
        completed_at = now(),
        updated_at = now(),
        next_attempt_at = now(),
        last_error = 'global_reservation_expired',
        payload_ciphertext = '\\x'::bytea
    WHERE operation.operation_id = sqlc.arg(operation_id)
      AND EXISTS (SELECT 1 FROM locked_operation)
    RETURNING operation.*
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, source,
        idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.signup.completion_abandoned',
        'hub_signup_completion',
        operation_id::text,
        'system',
        sqlc.arg(source),
        idempotency_key,
        jsonb_build_object(
            'hub_user_did', hub_user_did,
            'provisioning_user_deleted', EXISTS (SELECT 1 FROM deleted_user)
        )
    FROM updated
)
SELECT
    operation_id,
    hub_signup_request_id,
    token_hash,
    idempotency_key,
    request_digest,
    account_email_digest,
    hub_user_did,
    handle,
    reserve_command_id,
    activate_command_id,
    payload_ciphertext,
    state,
    failure_reason,
    conflicting_home_tenant_id,
    provisioning_expires_at,
    attempt_count,
    next_attempt_at,
    last_error,
    created_at,
    updated_at,
    completed_at,
    expires_at
FROM updated;

-- The reserve-hub-principal directory-email-claim-conflict path (GU-SIG-004):
-- the address is already an account elsewhere, discovered only once the
-- caller has proven mailbox control. conflicting_home_tenant_id is null when
-- the coordinator's resolve-hub-account-email lookup itself failed; the
-- completion still fails, just without naming a region.
-- name: FailHubSignupCompletionRegisteredElsewhere :one
WITH locked_operation AS (
    SELECT operation.*
    FROM vetchium.hub_signup_completions AS operation
    WHERE operation.operation_id = sqlc.arg(operation_id)
      AND operation.state = 'prepared'
    FOR UPDATE
), deactivated_request AS (
    UPDATE vetchium.hub_signup_requests AS request
    SET consumed_at = now(), active = false
    FROM locked_operation AS operation
    WHERE request.hub_signup_request_id = operation.hub_signup_request_id
    RETURNING request.hub_signup_request_id
), updated AS (
    UPDATE vetchium.hub_signup_completions AS operation
    SET state = 'failed',
        failure_reason = 'email_registered_elsewhere',
        conflicting_home_tenant_id = sqlc.narg(conflicting_home_tenant_id),
        completed_at = now(),
        updated_at = now(),
        next_attempt_at = now(),
        last_error = 'global_email_claim_conflict',
        payload_ciphertext = '\\x'::bytea
    WHERE operation.operation_id = sqlc.arg(operation_id)
      AND EXISTS (SELECT 1 FROM locked_operation)
    RETURNING operation.*
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, source,
        idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.signup.rejected',
        'hub_signup_completion',
        operation_id::text,
        'anonymous',
        'hub-api',
        idempotency_key,
        jsonb_build_object(
            'reason', 'email_registered_elsewhere',
            'home_tenant_id', conflicting_home_tenant_id
        )
    FROM updated
)
SELECT
    operation_id,
    hub_signup_request_id,
    token_hash,
    idempotency_key,
    request_digest,
    account_email_digest,
    hub_user_did,
    handle,
    reserve_command_id,
    activate_command_id,
    payload_ciphertext,
    state,
    failure_reason,
    conflicting_home_tenant_id,
    provisioning_expires_at,
    attempt_count,
    next_attempt_at,
    last_error,
    created_at,
    updated_at,
    completed_at,
    expires_at
FROM updated;

-- name: ListRecoverableHubSignupCompletions :many
SELECT
    operation_id,
    hub_signup_request_id,
    token_hash,
    idempotency_key,
    request_digest,
    account_email_digest,
    hub_user_did,
    handle,
    reserve_command_id,
    activate_command_id,
    payload_ciphertext,
    state,
    failure_reason,
    conflicting_home_tenant_id,
    provisioning_expires_at,
    attempt_count,
    next_attempt_at,
    last_error,
    created_at,
    updated_at,
    completed_at,
    expires_at
FROM vetchium.hub_signup_completions
WHERE state NOT IN ('completed', 'failed')
  AND next_attempt_at <= now()
ORDER BY next_attempt_at, created_at
LIMIT 25;

-- name: PruneExpiredHubSignupCompletions :one
WITH deleted AS (
    DELETE FROM vetchium.hub_signup_completions
    WHERE state IN ('completed', 'failed')
      AND expires_at <= now()
    RETURNING operation_id
), summary AS (
    SELECT count(*)::bigint AS deleted_count FROM deleted
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.housekeeping.signup-completions-pruned',
        'housekeeping_batch',
        gen_random_uuid()::text,
        'worker',
        'workers',
        'workers',
        jsonb_build_object('deleted_count', deleted_count)
    FROM summary
    WHERE deleted_count > 0
)
SELECT deleted_count FROM summary;

-- name: CompleteHubSignup :one
WITH eligible_signup AS (
    SELECT s.hub_signup_request_id, s.email_address, s.display_name,
        s.preferred_language, s.resident_country
    FROM vetchium.hub_signup_requests AS s
    WHERE s.hub_signup_request_id = sqlc.arg(hub_signup_request_id)
      AND s.active
      AND s.consumed_at IS NULL
      AND s.expires_at > now()
      AND EXISTS (
          SELECT 1 FROM vetchium.hub_signup_domains AS d
          WHERE d.domain = split_part(s.email_address, '@', 2)
            AND d.hub_signup_domain_state = 'active'
      )
      AND NOT EXISTS (
          SELECT 1
          FROM vetchium.hub_users AS u
          WHERE u.email_address = s.email_address
      )
    FOR UPDATE
),
-- ON CONFLICT DO NOTHING absorbs a random-handle collision as well as a
-- racing duplicate email. Either way no user row appears and the caller
-- retries with a fresh handle; 'conflict' below reports which happened.
inserted_user AS (
    INSERT INTO vetchium.hub_users (
        hub_user_did,
        handle,
        email_address,
        display_name,
        password_hash,
        preferred_language,
        resident_country,
        preferred_job_countries,
        hub_plan_oid
    )
    SELECT
        sqlc.arg(hub_user_did),
        sqlc.arg(handle),
        email_address,
        display_name,
        sqlc.arg(password_hash),
        preferred_language,
        resident_country,
        ARRAY[resident_country],
        sqlc.arg(default_hub_plan_oid)
    FROM eligible_signup
    ON CONFLICT DO NOTHING
    RETURNING hub_user_did, handle
), consumed AS (
    UPDATE vetchium.hub_signup_requests
    SET consumed_at = now(),
        active = false
    WHERE hub_signup_request_id IN (
        SELECT hub_signup_request_id FROM eligible_signup
    )
      AND EXISTS (SELECT 1 FROM inserted_user)
    RETURNING hub_signup_request_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id,
        action,
        entity_type,
        entity_id,
        actor_type,
        source,
        idempotency_key,
        payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.user.created',
        'hub_user',
        hub_user_did::text,
        'anonymous',
        'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('handle', handle)
    FROM inserted_user
    WHERE EXISTS (SELECT 1 FROM consumed)
), subscription_audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id,
        action,
        entity_type,
        entity_id,
        actor_type,
        source,
        idempotency_key,
        payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.subscription.created',
        'hub_subscription',
        hub_user_did::text,
        'anonymous',
        'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('hub_plan_oid', sqlc.arg(default_hub_plan_oid))
    FROM inserted_user
    WHERE EXISTS (SELECT 1 FROM consumed)
)
SELECT
    CASE
        WHEN EXISTS (SELECT 1 FROM consumed) THEN 'created'
        WHEN NOT EXISTS (SELECT 1 FROM eligible_signup) THEN 'ineligible'
        ELSE 'conflict'
    END::text AS result,
    COALESCE((SELECT hub_user_did FROM inserted_user)::text, '')::text
        AS hub_user_did,
    COALESCE((SELECT handle FROM inserted_user), '')::text AS handle;
