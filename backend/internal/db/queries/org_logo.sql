-- name: PrepareOrgLogoUpload :one
WITH owner AS (
    SELECT o.org_did
    FROM vetchium.orgs AS o
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.org_state = 'active'
      AND o.org_plan_oid = ANY(sqlc.arg(entitled_plan_oids)::text[])
    FOR UPDATE
), inserted AS (
    INSERT INTO vetchium.org_logo_objects (
        object_id, org_did, format, byte_size, width, height,
        content_sha256, upload_expires_at
    )
    SELECT sqlc.arg(object_id), owner.org_did, sqlc.arg(format),
        sqlc.arg(byte_size), sqlc.arg(width), sqlc.arg(height),
        sqlc.arg(content_sha256), now() + interval '15 minutes'
    FROM owner
    RETURNING object_id, org_did, format, byte_size, width, height
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.logo.upload-prepared', 'org_logo',
        object_id::text, 'org_user', sqlc.arg(actor_org_user_id)::text,
        'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object(
            'org_did', org_did, 'format', format, 'byte_size', byte_size,
            'width', width, 'height', height
        )
    FROM inserted
)
SELECT object_id FROM inserted;

-- name: LockOrgForLogoChange :exec
-- Run before the logo statements in each upload transaction. They lock the
-- owner inside CTEs that the planner may never scan (when no logo row matches),
-- and a statement that does wait keeps its pre-wait snapshot, missing a
-- concurrent upload's staged row.
SELECT 1
FROM vetchium.orgs
WHERE org_did = sqlc.arg(org_did)
FOR UPDATE;

-- name: GetOrgLogoUpload :one
WITH owner AS MATERIALIZED (
    SELECT o.org_did, o.org_plan_oid
    FROM vetchium.orgs AS o
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.org_state = 'active'
    FOR UPDATE
)
SELECT l.state, l.content_sha256, l.upload_expires_at, owner.org_plan_oid
FROM vetchium.org_logo_objects AS l
JOIN owner USING (org_did)
WHERE l.object_id = sqlc.arg(object_id)
  AND l.org_did = sqlc.arg(org_did)
FOR UPDATE OF l;

-- An in-flight PutObject is bounded to 30 seconds; delay deletion for one
-- minute so a superseded upload cannot recreate bytes after the worker deletes.
-- name: SupersedeOrgLogoUploads :one
WITH owner AS (
    SELECT o.org_did
    FROM vetchium.orgs AS o
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.org_state = 'active'
      AND o.org_plan_oid = ANY(sqlc.arg(entitled_plan_oids)::text[])
    FOR UPDATE
), retired AS (
    UPDATE vetchium.org_logo_objects AS l
    SET state = 'pending_delete', upload_expires_at = NULL,
        delete_requested_at = now(),
        next_attempt_at = now() + interval '1 minute'
    FROM owner
    WHERE l.org_did = owner.org_did
      AND l.state = 'uploading'
      AND l.object_id <> sqlc.arg(object_id)
    RETURNING l.object_id, l.org_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.logo.upload-superseded', 'org_logo',
        object_id::text, 'org_user', sqlc.arg(actor_org_user_id)::text,
        'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('org_did', org_did)
    FROM retired
)
SELECT count(*)::integer AS retired_count FROM retired;

-- Call before ActivateOrgLogo in the same transaction. PostgreSQL does not
-- order sibling data-modifying CTEs, so one statement cannot reliably vacate
-- the active-Org unique index before activating the new row.
-- name: RetireOrgLogoForReplacement :many
WITH owner AS (
    SELECT o.org_did
    FROM vetchium.orgs AS o
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.org_state = 'active'
      AND o.org_plan_oid = ANY(sqlc.arg(entitled_plan_oids)::text[])
    FOR UPDATE
), candidate AS (
    SELECT l.object_id, l.org_did
    FROM vetchium.org_logo_objects AS l
    JOIN owner USING (org_did)
    WHERE l.object_id = sqlc.arg(object_id)
      AND l.state = 'uploading'
      AND l.upload_expires_at > now()
)
UPDATE vetchium.org_logo_objects AS old
SET state = 'pending_delete', delete_requested_at = now(),
    upload_expires_at = NULL, next_attempt_at = now() + interval '1 minute'
WHERE old.org_did = (SELECT org_did FROM candidate)
  AND old.state = 'active'
RETURNING old.object_id;

-- name: ActivateOrgLogo :one
WITH owner AS (
    SELECT o.org_did
    FROM vetchium.orgs AS o
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.org_state = 'active'
      AND o.org_plan_oid = ANY(sqlc.arg(entitled_plan_oids)::text[])
    FOR UPDATE
), candidate AS (
    SELECT l.object_id, l.org_did
    FROM vetchium.org_logo_objects AS l
    JOIN owner USING (org_did)
    WHERE l.object_id = sqlc.arg(object_id)
      AND l.state = 'uploading'
      AND l.upload_expires_at > now()
), activated AS (
    UPDATE vetchium.org_logo_objects AS l
    SET state = 'active', upload_expires_at = NULL
    WHERE l.object_id = (SELECT object_id FROM candidate)
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_logo_objects AS old
          WHERE old.org_did = l.org_did AND old.state = 'active'
      )
    RETURNING l.object_id, l.org_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.logo.activated', 'org_logo',
        object_id::text, 'org_user', sqlc.arg(actor_org_user_id)::text,
        'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('org_did', org_did)
    FROM activated
)
SELECT object_id FROM activated;

-- name: RemoveOrgLogo :one
WITH owner AS (
    SELECT o.org_did
    FROM vetchium.orgs AS o
    WHERE o.org_did = sqlc.arg(org_did)
      AND o.org_state = 'active'
    FOR UPDATE
), removed AS (
    UPDATE vetchium.org_logo_objects AS l
    SET state = 'pending_delete', delete_requested_at = now(),
        next_attempt_at = now() + interval '1 minute'
    FROM owner
    WHERE l.org_did = owner.org_did AND l.state = 'active'
    RETURNING l.object_id, l.org_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.logo.removed', 'org_logo',
        object_id::text, 'org_user', sqlc.arg(actor_org_user_id)::text,
        'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('org_did', org_did)
    FROM removed
)
SELECT object_id FROM removed;

-- The active logo, which my-info signs a read URL for.
-- name: GetActiveOrgLogo :one
SELECT l.object_id
FROM vetchium.org_logo_objects AS l
WHERE l.org_did = sqlc.arg(org_did) AND l.state = 'active';

-- name: QueueExpiredOrgLogoUploads :one
WITH expired AS (
    UPDATE vetchium.org_logo_objects
    SET state = 'pending_delete', upload_expires_at = NULL,
        delete_requested_at = now(),
        next_attempt_at = now() + interval '1 minute'
    WHERE state = 'uploading' AND upload_expires_at <= now()
    RETURNING object_id, org_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.logo.upload-expired', 'org_logo',
        object_id::text, 'worker', NULL, 'workers',
        jsonb_build_object('org_did', org_did)
    FROM expired
)
SELECT count(*)::integer AS expired_count FROM expired;

-- name: ClaimOrgLogoDeletion :one
WITH candidate AS (
    SELECT object_id
    FROM vetchium.org_logo_objects
    WHERE state = 'pending_delete'
      AND next_attempt_at <= now()
      AND (leased_until IS NULL OR leased_until <= now())
    ORDER BY next_attempt_at, created_at, object_id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
), claimed AS (
    UPDATE vetchium.org_logo_objects AS l
    SET lease_token = sqlc.arg(lease_token),
        leased_until = now() + interval '1 minute',
        attempt_count = attempt_count + 1
    WHERE l.object_id = (SELECT object_id FROM candidate)
    RETURNING l.object_id, l.org_did, l.attempt_count
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.logo.deletion-claimed', 'org_logo',
        c.object_id::text, 'worker', NULL, 'workers',
        jsonb_build_object('org_did', c.org_did, 'attempt', c.attempt_count)
    FROM claimed AS c
)
SELECT c.object_id, c.org_did FROM claimed AS c;

-- The final SELECT's row count is the affected-row count.
-- name: RetryOrgLogoDeletion :execrows
WITH retried AS (
    UPDATE vetchium.org_logo_objects
    SET lease_token = NULL, leased_until = NULL,
        next_attempt_at = now() + LEAST(
            interval '5 minutes',
            interval '1 second' * power(2, LEAST(attempt_count, 8))
        ),
        last_error = left(sqlc.arg(last_error), 200)
    WHERE object_id = sqlc.arg(object_id)
      AND state = 'pending_delete'
      AND lease_token = sqlc.arg(lease_token)
    RETURNING object_id, org_did, attempt_count
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.logo.deletion-retry-scheduled', 'org_logo',
        c.object_id::text, 'worker', NULL, 'workers',
        jsonb_build_object('org_did', c.org_did, 'attempt', c.attempt_count)
    FROM retried AS c
)
SELECT r.object_id FROM retried AS r;

-- name: CompleteOrgLogoDeletion :one
WITH deleted AS (
    DELETE FROM vetchium.org_logo_objects
    WHERE object_id = sqlc.arg(object_id)
      AND state = 'pending_delete'
      AND lease_token = sqlc.arg(lease_token)
    RETURNING object_id, org_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.logo.object-deleted', 'org_logo',
        object_id::text, 'worker', NULL, 'workers',
        jsonb_build_object('org_did', org_did)
    FROM deleted
)
SELECT object_id FROM deleted;
