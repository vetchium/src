-- name: ResolveOrgDomain :one
SELECT
    p.org_did,
    d.domain,
    p.home_tenant_id,
    p.routing_version
FROM vetchium.org_domains AS d
INNER JOIN vetchium.org_principals AS p
    ON p.org_did = d.org_did
WHERE d.domain = sqlc.arg(domain)
  AND p.state = 'active';

-- name: ReserveOrgPrincipal :one
WITH principal AS (
    INSERT INTO vetchium.org_principals (
        org_did, home_tenant_id, state, provisioning_operation_id,
        provisioning_expires_at
    ) VALUES (
        sqlc.arg(org_did), sqlc.arg(home_tenant_id), 'provisioning',
        sqlc.arg(command_id), sqlc.arg(provisioning_expires_at)
    )
    RETURNING org_did, home_tenant_id, routing_version, directory_version,
        state
), claimed AS (
    INSERT INTO vetchium.org_domains (domain, org_did)
    SELECT sqlc.arg(domain), org_did FROM principal
    RETURNING domain
)
SELECT
    p.org_did, c.domain, p.home_tenant_id, p.routing_version,
    p.directory_version, p.state
FROM principal AS p
CROSS JOIN claimed AS c;

-- name: GetOrgPrincipal :one
SELECT org_did, home_tenant_id, state
FROM vetchium.org_principals
WHERE org_did = sqlc.arg(org_did);

-- name: ActivateOrgPrincipal :one
UPDATE vetchium.org_principals
SET state = 'active', provisioning_expires_at = NULL,
    activated_at = now(), updated_at = now(),
    directory_version = directory_version + 1
WHERE org_did = sqlc.arg(org_did)
  AND home_tenant_id = sqlc.arg(caller_tenant_id)
  AND state = 'provisioning'
  AND provisioning_expires_at > now()
RETURNING org_did, directory_version;

-- name: LockOrgPrincipal :one
SELECT
    p.org_did,
    p.home_tenant_id,
    p.state,
    d.domain
FROM vetchium.org_principals AS p
LEFT JOIN vetchium.org_domains AS d
    ON d.org_did = p.org_did
WHERE p.org_did = sqlc.arg(org_did)
FOR UPDATE OF p;

-- name: InsertOrgDomain :exec
INSERT INTO vetchium.org_domains (domain, org_did)
VALUES (sqlc.arg(domain), sqlc.arg(org_did));

-- name: DeleteOrgDomain :execrows
DELETE FROM vetchium.org_domains
WHERE org_did = sqlc.arg(org_did)
  AND domain = sqlc.arg(domain);

-- name: RecordOrgDomainChange :one
UPDATE vetchium.org_principals
SET directory_version = directory_version + 1,
    updated_at = now()
WHERE org_did = sqlc.arg(org_did)
RETURNING directory_version;

-- name: GetOrgPrincipalCommandView :one
SELECT
    p.org_did,
    d.domain,
    p.home_tenant_id,
    p.routing_version,
    p.state
FROM vetchium.org_principals AS p
LEFT JOIN vetchium.org_domains AS d
    ON d.org_did = p.org_did
WHERE p.org_did = sqlc.arg(org_did);

-- The coordinator reaps a reservation its home tenant never activated. The
-- audit event names that tenant, whose signup the reservation belonged to.
-- name: ReapExpiredOrgPrincipalReservations :execrows
WITH candidates AS MATERIALIZED (
    SELECT org_did, home_tenant_id, provisioning_operation_id
    FROM vetchium.org_principals
    WHERE state = 'provisioning'
      AND provisioning_expires_at <= now()
    ORDER BY provisioning_expires_at
    FOR UPDATE SKIP LOCKED
    LIMIT 100
), deleted_domains AS (
    DELETE FROM vetchium.org_domains AS domain
    USING candidates
    WHERE domain.org_did = candidates.org_did
    RETURNING domain.org_did, domain.domain
), deleted AS (
    DELETE FROM vetchium.org_principals AS principal
    USING candidates
    WHERE principal.org_did = candidates.org_did
      AND EXISTS (
          SELECT 1 FROM deleted_domains
          WHERE deleted_domains.org_did = principal.org_did
      )
    RETURNING principal.org_did
), audit AS (
    INSERT INTO vetchium.global_audit_events (
        action, entity_type, entity_id, actor_tenant_id, command_id, payload
    )
    SELECT
        'global_directory.org_principal_reservation_expired',
        'org_principal',
        c.org_did::text,
        c.home_tenant_id,
        c.provisioning_operation_id,
        jsonb_build_object(
            'schema_version', 1,
            'actor', 'global-coordinator',
            'released_domain', d.domain
        )
    FROM candidates AS c
    JOIN deleted AS removed ON removed.org_did = c.org_did
    JOIN deleted_domains AS d ON d.org_did = c.org_did
)
SELECT count(*) FROM deleted;
