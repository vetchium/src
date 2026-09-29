-- name: ResolveProfileSlug :one
SELECT
    p.hub_user_did,
    s.slug,
    s.kind,
    p.home_tenant_id,
    p.routing_version
FROM vetchium.hub_profile_slugs AS s
INNER JOIN vetchium.hub_principals AS p
    ON p.hub_user_did = s.hub_user_did
WHERE s.slug = sqlc.arg(slug)
  AND p.state = 'active';

-- name: GetPrincipal :one
SELECT
    hub_user_did,
    home_tenant_id,
    state,
    routing_version,
    directory_version,
    provisioning_operation_id,
    provisioning_expires_at,
    activated_at,
    alias_changed_at,
    created_at,
    updated_at
FROM vetchium.hub_principals
WHERE hub_user_did = sqlc.arg(hub_user_did);

-- The coordinator reaps a reservation its home tenant never activated,
-- together with its provisioning account-email claim (GU-DIR-010). The audit
-- event names that tenant, whose signup the reservation belonged to.
-- name: ReapExpiredHubPrincipalReservations :one
WITH candidates AS MATERIALIZED (
    SELECT hub_user_did, home_tenant_id, provisioning_operation_id
    FROM vetchium.hub_principals
    WHERE state = 'provisioning'
      AND provisioning_expires_at <= now()
    ORDER BY provisioning_expires_at
    FOR UPDATE SKIP LOCKED
    LIMIT 100
), deleted_slugs AS (
    DELETE FROM vetchium.hub_profile_slugs AS slug
    USING candidates
    WHERE slug.hub_user_did = candidates.hub_user_did
    RETURNING slug.hub_user_did
), deleted_claims AS (
    DELETE FROM vetchium.hub_account_email_claims AS claim
    USING candidates
    WHERE claim.hub_user_did = candidates.hub_user_did
    RETURNING claim.hub_user_did
), deleted AS (
    DELETE FROM vetchium.hub_principals AS principal
    USING candidates
    WHERE principal.hub_user_did = candidates.hub_user_did
      AND EXISTS (
          SELECT 1 FROM deleted_slugs
          WHERE deleted_slugs.hub_user_did = principal.hub_user_did
      )
    RETURNING principal.hub_user_did
), audit AS (
    INSERT INTO vetchium.global_audit_events (
        action, entity_type, entity_id, actor_tenant_id, command_id, payload
    )
    SELECT
        'global_directory.hub_principal_reservation_expired',
        'hub_principal',
        c.hub_user_did::text,
        c.home_tenant_id,
        c.provisioning_operation_id,
        jsonb_build_object(
            'schema_version', 1,
            'actor', 'global-coordinator',
            'email_claim_released', EXISTS (
                SELECT 1 FROM deleted_claims AS dc
                WHERE dc.hub_user_did = c.hub_user_did
            )
        )
    FROM candidates AS c
    INNER JOIN deleted AS removed ON removed.hub_user_did = c.hub_user_did
)
SELECT count(*) FROM deleted;

-- name: GetCommandResult :one
SELECT
    command_id,
    operation,
    caller_tenant_id,
    request_digest,
    response_status,
    response_body,
    completed_at
FROM vetchium.global_command_ledger
WHERE command_id = sqlc.arg(command_id);

-- name: AcquireCommandLock :exec
SELECT pg_advisory_xact_lock(
    hashtextextended(sqlc.arg(command_id)::text, 0)
);

-- The claim is inserted before the handle, and its failure aborts the whole
-- statement before the handle insert even runs, so a digest already claimed
-- elsewhere never burns a handle-rotation attempt (GU-DIR-002).
-- name: ReserveHubPrincipal :one
WITH principal AS (
    INSERT INTO vetchium.hub_principals (
        hub_user_did, home_tenant_id, state, provisioning_operation_id,
        provisioning_expires_at
    ) VALUES (
        sqlc.arg(hub_user_did), sqlc.arg(home_tenant_id), 'provisioning',
        sqlc.arg(command_id), sqlc.arg(provisioning_expires_at)
    )
    RETURNING hub_user_did, home_tenant_id, routing_version,
        directory_version, state
), claim AS (
    INSERT INTO vetchium.hub_account_email_claims (
        email_digest, hub_user_did, state, command_id
    )
    SELECT sqlc.arg(account_email_digest), hub_user_did, 'provisioning',
        sqlc.arg(command_id)
    FROM principal
    RETURNING email_digest
), handle AS (
    INSERT INTO vetchium.hub_profile_slugs (slug, hub_user_did, kind)
    SELECT sqlc.arg(handle), principal.hub_user_did, 'handle'
    FROM principal
    INNER JOIN claim ON TRUE
    RETURNING slug
)
SELECT
    p.hub_user_did, h.slug AS handle, NULL::text AS profile_alias,
    p.home_tenant_id, p.routing_version, p.directory_version, p.state
FROM principal AS p
CROSS JOIN handle AS h;

-- Activates the principal and, in the same statement, its provisioning
-- account email claim (GU-DIR-003). The claim update depends on
-- activated_principal via a real FROM reference, so the claim's transition
-- trigger sees the principal already active.
-- name: ActivateHubPrincipal :one
WITH activated_principal AS (
    UPDATE vetchium.hub_principals
    SET state = 'active', provisioning_expires_at = NULL,
        activated_at = now(), updated_at = now(),
        directory_version = directory_version + 1
    WHERE hub_principals.hub_user_did = sqlc.arg(hub_user_did)
      AND home_tenant_id = sqlc.arg(caller_tenant_id)
      AND state = 'provisioning'
      AND provisioning_expires_at > now()
    RETURNING hub_user_did, directory_version
), activated_claim AS (
    UPDATE vetchium.hub_account_email_claims AS claim
    SET state = 'active', updated_at = now()
    FROM activated_principal
    WHERE claim.hub_user_did = activated_principal.hub_user_did
      AND claim.state = 'provisioning'
    RETURNING claim.email_digest
)
SELECT
    p.hub_user_did,
    p.directory_version,
    (SELECT count(*) FROM activated_claim) AS activated_claim_count
FROM activated_principal AS p;

-- name: LockPrincipalForAlias :one
SELECT
    p.hub_user_did,
    p.home_tenant_id,
    p.state,
    p.alias_changed_at,
    p.directory_version,
    a.slug AS profile_alias,
    (
        p.alias_changed_at IS NULL OR
        p.alias_changed_at <= now() - interval '7 days'
    ) AS alias_change_allowed
FROM vetchium.hub_principals AS p
LEFT JOIN vetchium.hub_profile_slugs AS a
    ON a.hub_user_did = p.hub_user_did AND a.kind = 'alias'
WHERE p.hub_user_did = sqlc.arg(hub_user_did)
FOR UPDATE OF p;

-- name: DeleteHubAlias :exec
DELETE FROM vetchium.hub_profile_slugs
WHERE hub_user_did = sqlc.arg(hub_user_did)
  AND kind = 'alias';

-- name: InsertHubAlias :exec
INSERT INTO vetchium.hub_profile_slugs (slug, hub_user_did, kind)
VALUES (sqlc.arg(profile_alias), sqlc.arg(hub_user_did), 'alias');

-- name: RecordHubAliasChange :one
UPDATE vetchium.hub_principals
SET alias_changed_at = CASE WHEN sqlc.arg(record_cooldown)::boolean
        THEN now() ELSE alias_changed_at END,
    alias_revision = alias_revision + 1,
    updated_at = now(),
    directory_version = directory_version + 1
WHERE hub_user_did = sqlc.arg(hub_user_did)
RETURNING directory_version;

-- name: GetPrincipalCommandView :one
SELECT
    p.hub_user_did,
    h.slug AS handle,
    a.slug AS profile_alias,
    p.home_tenant_id,
    p.routing_version,
    p.directory_version,
    p.state
FROM vetchium.hub_principals AS p
INNER JOIN vetchium.hub_profile_slugs AS h
    ON h.hub_user_did = p.hub_user_did AND h.kind = 'handle'
LEFT JOIN vetchium.hub_profile_slugs AS a
    ON a.hub_user_did = p.hub_user_did AND a.kind = 'alias'
WHERE p.hub_user_did = sqlc.arg(hub_user_did);

-- name: InsertCommandResult :exec
INSERT INTO vetchium.global_command_ledger (
    command_id, operation, caller_tenant_id, request_digest,
    response_status, response_body
) VALUES (
    sqlc.arg(command_id), sqlc.arg(operation), sqlc.arg(caller_tenant_id),
    sqlc.arg(request_digest), sqlc.arg(response_status), sqlc.arg(response_body)
);

-- name: InsertGlobalAuditEvent :exec
INSERT INTO vetchium.global_audit_events (
    action, entity_type, entity_id, actor_tenant_id, command_id, payload
) VALUES (
    sqlc.arg(action), sqlc.arg(entity_type), sqlc.arg(entity_id),
    sqlc.arg(actor_tenant_id), sqlc.arg(command_id), sqlc.arg(payload)
);

-- name: InsertGlobalOutboxEvent :exec
INSERT INTO vetchium.global_outbox_events (
    aggregate_type, aggregate_id, aggregate_version, event_type, payload
) VALUES (
    sqlc.arg(aggregate_type), sqlc.arg(aggregate_id),
    sqlc.arg(aggregate_version), sqlc.arg(event_type), sqlc.arg(payload)
);
