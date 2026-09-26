-- name: CreateOrgSignupRequest :one
WITH blocked AS (
    SELECT 1
    FROM vetchium.org_signup_blocked_domains AS b
    WHERE sqlc.arg(domain)::text = b.domain
       OR sqlc.arg(domain)::text LIKE '%.' || b.domain
), owned AS (
    SELECT 1
    FROM vetchium.org_domains AS d
    WHERE d.domain = sqlc.arg(domain)::text
      AND d.domain_state <> 'released'
), upserted AS (
    INSERT INTO vetchium.org_signup_requests (
        org_signup_request_id,
        email_address,
        domain,
        preferred_language,
        verification_token,
        token_hash,
        expires_at
    )
    SELECT
        sqlc.arg(org_signup_request_id),
        sqlc.arg(email_address),
        sqlc.arg(domain),
        sqlc.arg(preferred_language),
        sqlc.arg(verification_token),
        sqlc.arg(token_hash),
        sqlc.arg(expires_at)
    WHERE NOT EXISTS (SELECT 1 FROM blocked)
      AND NOT EXISTS (SELECT 1 FROM owned)
    ON CONFLICT (email_address) WHERE active DO UPDATE
    SET org_signup_request_id = EXCLUDED.org_signup_request_id,
        domain = EXCLUDED.domain,
        preferred_language = EXCLUDED.preferred_language,
        verification_token = EXCLUDED.verification_token,
        token_hash = EXCLUDED.token_hash,
        created_at = now(),
        expires_at = EXCLUDED.expires_at,
        consumed_at = NULL,
        active = true
    RETURNING org_signup_request_id
), outbox AS (
    INSERT INTO vetchium.org_email_outbox (
        kind,
        recipient_email_address,
        preferred_language,
        payload_ciphertext
    )
    SELECT
        email.kind,
        sqlc.arg(email_address),
        sqlc.arg(preferred_language),
        email.payload_ciphertext
    FROM upserted
    CROSS JOIN (
        VALUES
            (
                'signup-dns-instructions',
                sqlc.arg(dns_payload_ciphertext)::bytea
            ),
            ('signup-link', sqlc.arg(link_payload_ciphertext)::bytea)
    ) AS email (kind, payload_ciphertext)
    RETURNING org_email_outbox_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, source,
        idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.signup.requested',
        'org_signup_request',
        org_signup_request_id::text,
        'anonymous',
        'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object(
            'domain', sqlc.arg(domain)::text,
            'preferred_language', sqlc.arg(preferred_language)::text,
            'emails_queued', (SELECT count(*) FROM outbox)
        )
    FROM upserted
)
SELECT CASE
    WHEN EXISTS (SELECT 1 FROM blocked) THEN 'blocked'
    WHEN EXISTS (SELECT 1 FROM owned) THEN 'owned'
    ELSE 'accepted'
END::text AS result;

-- name: GetOrgSignupDetails :one
SELECT domain, verification_token, expires_at
FROM vetchium.org_signup_requests
WHERE token_hash = sqlc.arg(token_hash)
  AND active
  AND consumed_at IS NULL
  AND expires_at > now();

-- name: FindOrgSignupForCompletion :one
SELECT
    org_signup_request_id,
    email_address,
    domain,
    preferred_language,
    verification_token
FROM vetchium.org_signup_requests
WHERE token_hash = sqlc.arg(token_hash)
  AND active
  AND consumed_at IS NULL
  AND expires_at > now();

-- name: CheckOrgDomainAdmission :one
SELECT
    EXISTS (
        SELECT 1
        FROM vetchium.org_signup_blocked_domains AS b
        WHERE sqlc.arg(domain)::text = b.domain
           OR sqlc.arg(domain)::text LIKE '%.' || b.domain
    ) AS blocked,
    EXISTS (
        SELECT 1
        FROM vetchium.org_domains AS d
        WHERE d.domain = sqlc.arg(domain)::text
          AND d.domain_state <> 'released'
    ) AS locally_owned;

-- name: GetOrgSignupCompletionByTokenHash :one
SELECT
    operation_id,
    org_signup_request_id,
    token_hash,
    idempotency_key,
    request_digest,
    org_did,
    domain,
    reserve_command_id,
    activate_command_id,
    payload_ciphertext,
    state,
    failure_reason,
    provisioning_expires_at,
    attempt_count,
    next_attempt_at,
    last_error,
    created_at,
    updated_at,
    completed_at,
    expires_at
FROM vetchium.org_signup_completions
WHERE token_hash = sqlc.arg(token_hash)
  AND expires_at > now();

-- name: GetOrgSignupCompletion :one
SELECT
    operation_id,
    org_signup_request_id,
    token_hash,
    idempotency_key,
    request_digest,
    org_did,
    domain,
    reserve_command_id,
    activate_command_id,
    payload_ciphertext,
    state,
    failure_reason,
    provisioning_expires_at,
    attempt_count,
    next_attempt_at,
    last_error,
    created_at,
    updated_at,
    completed_at,
    expires_at
FROM vetchium.org_signup_completions
WHERE operation_id = sqlc.arg(operation_id)
  AND expires_at > now();

-- name: PrepareOrgSignupCompletion :one
WITH eligible_signup AS (
    SELECT s.org_signup_request_id, s.domain
    FROM vetchium.org_signup_requests AS s
    WHERE s.org_signup_request_id = sqlc.arg(org_signup_request_id)
      AND s.token_hash = sqlc.arg(token_hash)
      AND s.active
      AND s.consumed_at IS NULL
      AND s.expires_at > now()
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_signup_blocked_domains AS b
          WHERE s.domain = b.domain OR s.domain LIKE '%.' || b.domain
      )
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_domains AS d
          WHERE d.domain = s.domain AND d.domain_state <> 'released'
      )
    FOR UPDATE
), inserted AS (
    INSERT INTO vetchium.org_signup_completions (
        operation_id,
        org_signup_request_id,
        token_hash,
        idempotency_key,
        request_digest,
        org_did,
        domain,
        reserve_command_id,
        activate_command_id,
        payload_ciphertext,
        provisioning_expires_at,
        expires_at
    )
    SELECT
        sqlc.arg(operation_id),
        org_signup_request_id,
        sqlc.arg(token_hash),
        sqlc.arg(idempotency_key),
        sqlc.arg(request_digest),
        sqlc.arg(org_did),
        domain,
        sqlc.arg(reserve_command_id),
        sqlc.arg(activate_command_id),
        sqlc.arg(payload_ciphertext),
        sqlc.arg(provisioning_expires_at),
        sqlc.arg(expires_at)
    FROM eligible_signup
    ON CONFLICT DO NOTHING
    RETURNING *
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, source,
        idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.signup.completion_prepared',
        'org_signup_completion',
        operation_id::text,
        'anonymous',
        'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('org_did', org_did, 'domain', domain)
    FROM inserted
)
SELECT
    operation_id,
    org_signup_request_id,
    token_hash,
    idempotency_key,
    request_digest,
    org_did,
    domain,
    reserve_command_id,
    activate_command_id,
    payload_ciphertext,
    state,
    failure_reason,
    provisioning_expires_at,
    attempt_count,
    next_attempt_at,
    last_error,
    created_at,
    updated_at,
    completed_at,
    expires_at
FROM inserted;

-- name: MarkOrgSignupCompletionReserved :one
UPDATE vetchium.org_signup_completions
SET state = 'reserved',
    attempt_count = attempt_count + 1,
    updated_at = now(),
    next_attempt_at = now(),
    last_error = NULL
WHERE operation_id = sqlc.arg(operation_id)
  AND state = 'prepared'
  AND reserve_command_id = sqlc.arg(reserve_command_id)
RETURNING
    operation_id,
    org_signup_request_id,
    token_hash,
    idempotency_key,
    request_digest,
    org_did,
    domain,
    reserve_command_id,
    activate_command_id,
    payload_ciphertext,
    state,
    failure_reason,
    provisioning_expires_at,
    attempt_count,
    next_attempt_at,
    last_error,
    created_at,
    updated_at,
    completed_at,
    expires_at;

-- A definite claim conflict means the signup can never succeed, so the
-- request is retired with the operation.
-- name: FailOrgSignupCompletionDomainOwned :one
WITH updated AS (
    UPDATE vetchium.org_signup_completions
    SET state = 'failed',
        failure_reason = 'domain_owned',
        completed_at = now(),
        updated_at = now(),
        next_attempt_at = now(),
        last_error = 'global_domain_conflict',
        payload_ciphertext = '\x'::bytea
    WHERE operation_id = sqlc.arg(operation_id)
      AND state = 'prepared'
    RETURNING *
), retired AS (
    UPDATE vetchium.org_signup_requests AS s
    SET active = false
    FROM updated
    WHERE s.org_signup_request_id = updated.org_signup_request_id
      AND s.active
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, source,
        idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.signup.completion_rejected',
        'org_signup_completion',
        operation_id::text,
        'anonymous',
        sqlc.arg(source),
        idempotency_key,
        jsonb_build_object('reason', 'domain_owned', 'domain', domain)
    FROM updated
)
SELECT
    operation_id,
    org_signup_request_id,
    token_hash,
    idempotency_key,
    request_digest,
    org_did,
    domain,
    reserve_command_id,
    activate_command_id,
    payload_ciphertext,
    state,
    failure_reason,
    provisioning_expires_at,
    attempt_count,
    next_attempt_at,
    last_error,
    created_at,
    updated_at,
    completed_at,
    expires_at
FROM updated;

-- name: RecordOrgSignupCompletionRetry :exec
UPDATE vetchium.org_signup_completions
SET attempt_count = attempt_count + 1,
    updated_at = now(),
    next_attempt_at = now() + LEAST(
        interval '5 minutes',
        interval '1 second' * power(2, LEAST(attempt_count, 8))
    ),
    last_error = left(sqlc.arg(last_error), 200)
WHERE operation_id = sqlc.arg(operation_id)
  AND state NOT IN ('completed', 'failed');

-- The Org and its first superadmin stay non-loginable until the global
-- activation succeeds.
-- name: CreateProvisioningOrg :one
WITH locked_operation AS (
    SELECT operation.*
    FROM vetchium.org_signup_completions AS operation
    WHERE operation.operation_id = sqlc.arg(operation_id)
      AND operation.state = 'reserved'
    FOR UPDATE
), inserted_org AS (
    INSERT INTO vetchium.orgs (org_did, display_name, org_plan_oid)
    SELECT org_did, sqlc.arg(display_name), sqlc.arg(org_plan_oid)
    FROM locked_operation
    RETURNING org_did
), inserted_domain AS (
    INSERT INTO vetchium.org_domains (
        org_did,
        domain,
        verification_token,
        last_verified_at,
        last_conclusive_at,
        next_check_at
    )
    SELECT
        operation.org_did,
        operation.domain,
        sqlc.arg(verification_token),
        operation.created_at,
        operation.created_at,
        sqlc.arg(next_check_at)
    FROM locked_operation AS operation
    WHERE EXISTS (SELECT 1 FROM inserted_org)
    RETURNING org_did
), inserted_user AS (
    INSERT INTO vetchium.org_users (
        org_user_id,
        org_did,
        email_address,
        preferred_language
    )
    SELECT
        gen_random_uuid(),
        org_did,
        sqlc.arg(email_address),
        sqlc.arg(preferred_language)
    FROM inserted_domain
    RETURNING org_user_id, org_did
), inserted_password AS (
    INSERT INTO vetchium.org_user_passwords (org_user_id, password_hash)
    SELECT org_user_id, sqlc.arg(password_hash)
    FROM inserted_user
    RETURNING org_user_id
), granted AS (
    INSERT INTO vetchium.org_user_permissions (org_user_id, permission)
    SELECT org_user_id, 'org:superadmin'
    FROM inserted_password
    RETURNING org_user_id
), consumed AS (
    UPDATE vetchium.org_signup_requests
    SET consumed_at = now(), active = false
    WHERE org_signup_request_id = (
        SELECT org_signup_request_id FROM locked_operation
    )
      AND EXISTS (SELECT 1 FROM granted)
    RETURNING org_signup_request_id
), updated AS (
    UPDATE vetchium.org_signup_completions AS operation
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
        'org.provisioning',
        'org',
        org_did::text,
        'anonymous',
        sqlc.arg(source),
        idempotency_key,
        jsonb_build_object('domain', domain, 'operation_id', operation_id)
    FROM updated
)
SELECT
    operation_id,
    org_signup_request_id,
    token_hash,
    idempotency_key,
    request_digest,
    org_did,
    domain,
    reserve_command_id,
    activate_command_id,
    payload_ciphertext,
    state,
    failure_reason,
    provisioning_expires_at,
    attempt_count,
    next_attempt_at,
    last_error,
    created_at,
    updated_at,
    completed_at,
    expires_at
FROM updated;

-- name: CompleteProvisioningOrg :one
WITH locked_operation AS (
    SELECT operation.*
    FROM vetchium.org_signup_completions AS operation
    WHERE operation.operation_id = sqlc.arg(operation_id)
      AND operation.state = 'local_created'
    FOR UPDATE
), activated_org AS (
    UPDATE vetchium.orgs AS o
    SET org_state = 'active', updated_at = now()
    FROM locked_operation AS operation
    WHERE o.org_did = operation.org_did
      AND o.org_state = 'provisioning'
    RETURNING o.org_did, o.org_plan_oid
), activated_users AS (
    UPDATE vetchium.org_users AS u
    SET org_user_state = 'active', updated_at = now()
    FROM activated_org AS o
    WHERE u.org_did = o.org_did
      AND u.org_user_state = 'provisioning'
    RETURNING u.org_user_id, u.org_did
), updated AS (
    UPDATE vetchium.org_signup_completions AS operation
    SET state = 'completed',
        completed_at = now(),
        updated_at = now(),
        next_attempt_at = now(),
        last_error = NULL,
        payload_ciphertext = '\x'::bytea
    WHERE operation.operation_id = sqlc.arg(operation_id)
      AND EXISTS (SELECT 1 FROM activated_users)
    RETURNING *
), org_audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, source,
        idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.created',
        'org',
        org.org_did::text,
        'anonymous',
        sqlc.arg(source),
        operation.idempotency_key,
        jsonb_build_object(
            'domain', operation.domain,
            'org_plan_oid', org.org_plan_oid
        )
    FROM activated_org AS org
    CROSS JOIN updated AS operation
), user_audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, source,
        idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org_user.created',
        'org_user',
        u.org_user_id::text,
        'anonymous',
        sqlc.arg(source),
        operation.idempotency_key,
        jsonb_build_object(
            'org_did', u.org_did,
            'permissions', jsonb_build_array('org:superadmin')
        )
    FROM activated_users AS u
    CROSS JOIN updated AS operation
)
SELECT
    operation_id,
    org_signup_request_id,
    token_hash,
    idempotency_key,
    request_digest,
    org_did,
    domain,
    reserve_command_id,
    activate_command_id,
    payload_ciphertext,
    state,
    failure_reason,
    provisioning_expires_at,
    attempt_count,
    next_attempt_at,
    last_error,
    created_at,
    updated_at,
    completed_at,
    expires_at
FROM updated;

-- name: AbandonExpiredOrgSignupCompletion :one
WITH locked_operation AS (
    SELECT operation.*
    FROM vetchium.org_signup_completions AS operation
    WHERE operation.operation_id = sqlc.arg(operation_id)
      AND operation.state NOT IN ('completed', 'failed')
      AND operation.provisioning_expires_at <= now()
    FOR UPDATE
), deleted_org AS (
    DELETE FROM vetchium.orgs AS org
    USING locked_operation AS operation
    WHERE org.org_did = operation.org_did
      AND org.org_state = 'provisioning'
    RETURNING org.org_did
), updated AS (
    UPDATE vetchium.org_signup_completions AS operation
    SET state = 'failed',
        failure_reason = 'reservation_expired',
        completed_at = now(),
        updated_at = now(),
        next_attempt_at = now(),
        last_error = 'global_reservation_expired',
        payload_ciphertext = '\x'::bytea
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
        'org.signup.completion_abandoned',
        'org_signup_completion',
        operation_id::text,
        'system',
        sqlc.arg(source),
        idempotency_key,
        jsonb_build_object(
            'org_did', org_did,
            'provisioning_org_deleted', EXISTS (SELECT 1 FROM deleted_org)
        )
    FROM updated
)
SELECT
    operation_id,
    org_signup_request_id,
    token_hash,
    idempotency_key,
    request_digest,
    org_did,
    domain,
    reserve_command_id,
    activate_command_id,
    payload_ciphertext,
    state,
    failure_reason,
    provisioning_expires_at,
    attempt_count,
    next_attempt_at,
    last_error,
    created_at,
    updated_at,
    completed_at,
    expires_at
FROM updated;

-- name: ListRecoverableOrgSignupCompletions :many
SELECT
    operation_id,
    org_signup_request_id,
    token_hash,
    idempotency_key,
    request_digest,
    org_did,
    domain,
    reserve_command_id,
    activate_command_id,
    payload_ciphertext,
    state,
    failure_reason,
    provisioning_expires_at,
    attempt_count,
    next_attempt_at,
    last_error,
    created_at,
    updated_at,
    completed_at,
    expires_at
FROM vetchium.org_signup_completions
WHERE state NOT IN ('completed', 'failed')
  AND next_attempt_at <= now()
ORDER BY next_attempt_at, created_at
LIMIT 25;

-- name: PruneExpiredOrgSignupCompletions :execrows
DELETE FROM vetchium.org_signup_completions
WHERE state IN ('completed', 'failed')
  AND expires_at <= now();
