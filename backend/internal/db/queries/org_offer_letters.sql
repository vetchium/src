-- Offer letters (agent-guides/object-storage.md, Offer letters). An upload
-- runs in two transactions around the object-store Put; each takes the
-- uploader's row lock first (LockOrgUserForOfferLetter), so concurrent
-- uploads by one user serialize and the later one supersedes the earlier.

-- Whether the user may extend an offer anywhere: they act on the
-- applications of at least one of the Org's Openings.
-- name: OrgUserActsOnAnyApplications :one
SELECT EXISTS (
    SELECT 1 FROM vetchium.org_openings AS o
    WHERE o.org_did = sqlc.arg(org_did)
      AND vetchium.org_user_acts_on_applications(o.org_opening_id,
          sqlc.arg(org_user_id))
)::boolean AS can_act;

-- Run before the letter statements in each upload transaction; a statement
-- that waited inside a CTE would keep its pre-wait snapshot and miss a
-- concurrent upload's staged row.
-- name: LockOrgUserForOfferLetter :exec
SELECT 1
FROM vetchium.org_users
WHERE org_user_id = sqlc.arg(org_user_id)
FOR UPDATE;

-- name: GetOrgOfferLetterUpload :one
SELECT l.state, l.content_sha256, l.upload_expires_at
FROM vetchium.org_offer_letter_objects AS l
WHERE l.object_id = sqlc.arg(object_id)
  AND l.org_did = sqlc.arg(org_did)
  AND l.uploaded_by = sqlc.arg(org_user_id)
FOR UPDATE;

-- An in-flight Put is bounded to 30 seconds; delay deletion for one minute
-- so a superseded upload cannot recreate bytes after the worker deletes.
-- name: SupersedeOrgOfferLetterUploads :one
WITH retired AS (
    UPDATE vetchium.org_offer_letter_objects AS l
    SET state = 'pending_delete', upload_expires_at = NULL,
        delete_requested_at = now(),
        next_attempt_at = now() + interval '1 minute'
    WHERE l.uploaded_by = sqlc.arg(org_user_id)
      AND l.state IN ('uploading', 'uploaded')
      AND l.object_id <> sqlc.arg(object_id)
    RETURNING l.object_id, l.org_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        subject_org_did, tenant_id, action, entity_type, entity_id,
        actor_type, actor_id, source, idempotency_key, payload
    )
    SELECT org_did, sqlc.arg(tenant_id), 'org.offer_letter.superseded',
        'org_offer_letter', object_id::text, 'org_user',
        sqlc.arg(org_user_id)::text, 'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('org_did', org_did)
    FROM retired
)
SELECT count(*)::integer AS retired_count FROM retired;

-- name: PrepareOrgOfferLetterUpload :one
WITH inserted AS (
    INSERT INTO vetchium.org_offer_letter_objects (
        object_id, org_did, uploaded_by, byte_size, content_sha256,
        upload_expires_at
    )
    VALUES (
        sqlc.arg(object_id), sqlc.arg(org_did), sqlc.arg(org_user_id),
        sqlc.arg(byte_size), sqlc.arg(content_sha256),
        now() + interval '15 minutes'
    )
    RETURNING object_id, org_did, byte_size
), audit AS (
    INSERT INTO vetchium.audit_events (
        subject_org_did, tenant_id, action, entity_type, entity_id,
        actor_type, actor_id, source, idempotency_key, payload
    )
    SELECT org_did, sqlc.arg(tenant_id), 'org.offer_letter.upload-prepared',
        'org_offer_letter', object_id::text, 'org_user',
        sqlc.arg(org_user_id)::text, 'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('org_did', org_did, 'byte_size', byte_size)
    FROM inserted
)
SELECT object_id FROM inserted;

-- The stored letter is claimable for an hour by the uploader's next offer.
-- name: MarkOrgOfferLetterUploaded :one
WITH uploaded AS (
    UPDATE vetchium.org_offer_letter_objects AS l
    SET state = 'uploaded', upload_expires_at = now() + interval '1 hour'
    WHERE l.object_id = sqlc.arg(object_id)
      AND l.org_did = sqlc.arg(org_did)
      AND l.uploaded_by = sqlc.arg(org_user_id)
      AND l.state = 'uploading'
      AND l.upload_expires_at > now()
    RETURNING l.object_id, l.org_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        subject_org_did, tenant_id, action, entity_type, entity_id,
        actor_type, actor_id, source, idempotency_key, payload
    )
    SELECT org_did, sqlc.arg(tenant_id), 'org.offer_letter.uploaded',
        'org_offer_letter', object_id::text, 'org_user',
        sqlc.arg(org_user_id)::text, 'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('org_did', org_did)
    FROM uploaded
)
SELECT object_id FROM uploaded;

-- The offer extension claims the caller's own unexpired letter; it runs in
-- the transaction holding the application's lock, beside the offer's audit.
-- name: ClaimOrgOfferLetter :one
UPDATE vetchium.org_offer_letter_objects AS l
SET state = 'active', upload_expires_at = NULL
WHERE l.object_id = sqlc.arg(object_id)
  AND l.org_did = sqlc.arg(org_did)
  AND l.uploaded_by = sqlc.arg(org_user_id)
  AND l.state = 'uploaded'
  AND l.upload_expires_at > now()
RETURNING l.object_id;

-- name: QueueExpiredOrgOfferLetters :one
WITH expired AS (
    UPDATE vetchium.org_offer_letter_objects
    SET state = 'pending_delete', upload_expires_at = NULL,
        delete_requested_at = now(),
        next_attempt_at = now() + interval '1 minute'
    WHERE state IN ('uploading', 'uploaded') AND upload_expires_at <= now()
    RETURNING object_id, org_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        subject_org_did, tenant_id, action, entity_type, entity_id,
        actor_type, actor_id, source, payload
    )
    SELECT org_did, sqlc.arg(tenant_id), 'org.offer_letter.upload-expired',
        'org_offer_letter', object_id::text, 'worker', NULL, 'workers',
        jsonb_build_object('org_did', org_did)
    FROM expired
)
SELECT count(*)::integer AS expired_count FROM expired;

-- name: ClaimOrgOfferLetterDeletion :one
WITH candidate AS (
    SELECT object_id
    FROM vetchium.org_offer_letter_objects
    WHERE state = 'pending_delete'
      AND next_attempt_at <= now()
      AND (leased_until IS NULL OR leased_until <= now())
    ORDER BY next_attempt_at, created_at, object_id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
), claimed AS (
    UPDATE vetchium.org_offer_letter_objects AS l
    SET lease_token = sqlc.arg(lease_token),
        leased_until = now() + interval '1 minute',
        attempt_count = attempt_count + 1
    WHERE l.object_id = (SELECT object_id FROM candidate)
    RETURNING l.object_id, l.org_did, l.attempt_count
), audit AS (
    INSERT INTO vetchium.audit_events (
        subject_org_did, tenant_id, action, entity_type, entity_id,
        actor_type, actor_id, source, payload
    )
    SELECT c.org_did, sqlc.arg(tenant_id),
        'org.offer_letter.deletion-claimed', 'org_offer_letter',
        c.object_id::text, 'worker', NULL, 'workers',
        jsonb_build_object('org_did', c.org_did, 'attempt', c.attempt_count)
    FROM claimed AS c
)
SELECT c.object_id, c.org_did FROM claimed AS c;

-- The final SELECT's row count is the affected-row count.
-- name: RetryOrgOfferLetterDeletion :execrows
WITH retried AS (
    UPDATE vetchium.org_offer_letter_objects
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
        subject_org_did, tenant_id, action, entity_type, entity_id,
        actor_type, actor_id, source, payload
    )
    SELECT c.org_did, sqlc.arg(tenant_id),
        'org.offer_letter.deletion-retry-scheduled', 'org_offer_letter',
        c.object_id::text, 'worker', NULL, 'workers',
        jsonb_build_object('org_did', c.org_did, 'attempt', c.attempt_count)
    FROM retried AS c
)
SELECT r.object_id FROM retried AS r;

-- name: CompleteOrgOfferLetterDeletion :one
WITH deleted AS (
    DELETE FROM vetchium.org_offer_letter_objects
    WHERE object_id = sqlc.arg(object_id)
      AND state = 'pending_delete'
      AND lease_token = sqlc.arg(lease_token)
    RETURNING object_id, org_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        subject_org_did, tenant_id, action, entity_type, entity_id,
        actor_type, actor_id, source, payload
    )
    SELECT org_did, sqlc.arg(tenant_id), 'org.offer_letter.object-deleted',
        'org_offer_letter', object_id::text, 'worker', NULL, 'workers',
        jsonb_build_object('org_did', org_did)
    FROM deleted
)
SELECT object_id FROM deleted;
