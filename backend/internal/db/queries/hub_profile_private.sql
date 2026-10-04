-- name: ListHubProfessionalEmails :many
SELECT
    professional_email_id,
    email_address,
    domain,
    first_verified_at,
    last_verified_at,
    created_at,
    updated_at
FROM vetchium.hub_professional_emails AS e
WHERE e.hub_user_did = sqlc.arg(hub_user_did)
  AND EXISTS (
      SELECT 1 FROM vetchium.hub_users AS owner
      WHERE owner.hub_user_did = sqlc.arg(hub_user_did)
        AND owner.hub_user_state = 'active'
  )
ORDER BY (last_verified_at IS NOT NULL) DESC,
    last_verified_at DESC NULLS LAST,
    created_at DESC,
    professional_email_id;

-- name: CreateHubProfessionalEmail :one
WITH owner AS (
    SELECT u.hub_user_did
    FROM vetchium.hub_users AS u
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
    FOR UPDATE
), inserted AS (
    INSERT INTO vetchium.hub_professional_emails (
        professional_email_id, hub_user_did, email_address, domain
    )
    SELECT sqlc.arg(professional_email_id), owner.hub_user_did,
        sqlc.arg(email_address), sqlc.arg(domain)
    FROM owner
    WHERE (SELECT count(*) FROM vetchium.hub_professional_emails AS existing
           WHERE existing.hub_user_did = owner.hub_user_did) < 10
    RETURNING professional_email_id, hub_user_did, email_address, domain,
        first_verified_at, last_verified_at, created_at, updated_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.professional-email-created',
        'hub_professional_email', professional_email_id::text, 'hub_user',
        hub_user_did::text, 'hub-api', sqlc.arg(idempotency_key),
        jsonb_build_object(
            'schema_version', 1,
            'domain_sha256', encode(sha256(convert_to(domain::text, 'UTF8')), 'hex')
        )
    FROM inserted
)
SELECT professional_email_id, hub_user_did, email_address, domain,
    first_verified_at, last_verified_at, created_at, updated_at
FROM inserted;

-- name: DeleteHubProfessionalEmail :one
WITH deleted AS (
    DELETE FROM vetchium.hub_professional_emails AS e
    WHERE e.professional_email_id = sqlc.arg(professional_email_id)
      AND e.hub_user_did = sqlc.arg(hub_user_did)
      AND EXISTS (
          SELECT 1 FROM vetchium.hub_users AS u
          WHERE u.hub_user_did = sqlc.arg(hub_user_did)
            AND u.hub_user_state = 'active'
          FOR UPDATE
      )
    RETURNING professional_email_id, hub_user_did, domain,
        first_verified_at IS NOT NULL AS was_verified
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.professional-email-deleted',
        'hub_professional_email', professional_email_id::text, 'hub_user',
        hub_user_did::text, 'hub-api', sqlc.arg(idempotency_key),
        jsonb_build_object(
            'schema_version', 1, 'was_verified', was_verified,
            'domain_sha256', encode(sha256(convert_to(domain::text, 'UTF8')), 'hex')
        )
    FROM deleted
)
SELECT professional_email_id FROM deleted;

-- name: SupersedeHubProfessionalEmailChallenges :execrows
-- Call before IssueHubProfessionalEmailChallenge in the same transaction.
-- Sibling data-modifying CTEs cannot reliably vacate the active-email index.
UPDATE vetchium.hub_professional_email_challenges AS old
SET superseded_at = now()
WHERE old.professional_email_id = sqlc.arg(professional_email_id)
  AND EXISTS (
      SELECT 1 FROM vetchium.hub_professional_emails AS e
      JOIN vetchium.hub_users AS u USING (hub_user_did)
      WHERE e.professional_email_id = old.professional_email_id
        AND e.hub_user_did = sqlc.arg(hub_user_did)
        AND u.hub_user_state = 'active'
      FOR UPDATE OF e, u
  )
  AND old.consumed_at IS NULL
  AND old.superseded_at IS NULL
  AND old.attempt_count < 5;

-- name: HubProfessionalEmailExistsForOwner :one
SELECT 1::integer AS exists_for_owner
FROM vetchium.hub_professional_emails AS e
JOIN vetchium.hub_users AS u USING (hub_user_did)
WHERE e.professional_email_id = sqlc.arg(professional_email_id)
  AND e.hub_user_did = sqlc.arg(hub_user_did)
  AND u.hub_user_state = 'active';

-- name: IssueHubProfessionalEmailChallenge :one
WITH eligible AS (
    SELECT e.professional_email_id, e.hub_user_did, e.email_address,
        u.preferred_language
    FROM vetchium.hub_professional_emails AS e
    JOIN vetchium.hub_users AS u USING (hub_user_did)
    WHERE e.professional_email_id = sqlc.arg(professional_email_id)
      AND e.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
      AND NOT EXISTS (
          SELECT 1
          FROM vetchium.hub_professional_email_challenges AS recent
          WHERE recent.professional_email_id = e.professional_email_id
            AND recent.created_at > now() - interval '60 seconds'
      )
      AND (
          SELECT count(*)
          FROM vetchium.hub_professional_email_challenges AS hourly
          WHERE hourly.professional_email_id = e.professional_email_id
            AND hourly.created_at > now() - interval '1 hour'
      ) < 5
    FOR UPDATE OF e, u
), inserted AS (
    INSERT INTO vetchium.hub_professional_email_challenges (
        challenge_id, professional_email_id, code_hash, expires_at
    )
    SELECT sqlc.arg(challenge_id), professional_email_id,
        sqlc.arg(code_hash), now() + interval '10 minutes'
    FROM eligible
    RETURNING challenge_id, professional_email_id, created_at, expires_at
), outbox AS (
    INSERT INTO vetchium.hub_email_outbox (
        kind, recipient_email_address, preferred_language, payload_ciphertext
    )
    SELECT 'professional-email-verification', eligible.email_address,
        eligible.preferred_language, sqlc.arg(payload_ciphertext)
    FROM eligible
    JOIN inserted USING (professional_email_id)
    RETURNING hub_email_outbox_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id),
        'hub.profile.professional-email-verification-requested',
        'hub_professional_email', eligible.professional_email_id::text,
        'hub_user', eligible.hub_user_did::text, 'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('message_queued', true)
    FROM eligible
    JOIN inserted USING (professional_email_id)
    WHERE EXISTS (SELECT 1 FROM outbox)
)
SELECT inserted.challenge_id, inserted.created_at, inserted.expires_at
FROM inserted
WHERE EXISTS (SELECT 1 FROM outbox);

-- name: VerifyHubProfessionalEmailChallenge :one
WITH candidate AS (
    SELECT c.challenge_id, c.professional_email_id, c.code_hash,
        c.attempt_count, e.hub_user_did
    FROM vetchium.hub_professional_email_challenges AS c
    JOIN vetchium.hub_professional_emails AS e USING (professional_email_id)
    JOIN vetchium.hub_users AS u USING (hub_user_did)
    WHERE c.challenge_id = sqlc.arg(challenge_id)
      AND e.professional_email_id = sqlc.arg(professional_email_id)
      AND e.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
      AND c.consumed_at IS NULL
      AND c.superseded_at IS NULL
      AND c.expires_at > now()
      AND c.attempt_count < 5
    FOR UPDATE OF c, e
), attempted AS (
    UPDATE vetchium.hub_professional_email_challenges AS c
    SET attempt_count = c.attempt_count + 1,
        consumed_at = CASE
            WHEN c.code_hash = sqlc.arg(code_hash) THEN now()
            ELSE NULL
        END
    FROM candidate
    WHERE c.challenge_id = candidate.challenge_id
    RETURNING c.challenge_id, c.professional_email_id, c.attempt_count,
        candidate.hub_user_did,
        candidate.code_hash = sqlc.arg(code_hash) AS verified
), verified_email AS (
    UPDATE vetchium.hub_professional_emails AS e
    SET first_verified_at = COALESCE(e.first_verified_at, now()),
        last_verified_at = now(),
        updated_at = now()
    FROM attempted
    WHERE e.professional_email_id = attempted.professional_email_id
      AND attempted.verified
    RETURNING e.professional_email_id, e.first_verified_at,
        e.last_verified_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id),
        CASE WHEN attempted.verified
            THEN 'hub.profile.professional-email-verified'
            ELSE 'hub.profile.professional-email-verification-failed' END,
        'hub_professional_email', attempted.professional_email_id::text,
        'hub_user', attempted.hub_user_did::text, 'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('attempt_count', attempted.attempt_count)
    FROM attempted
)
SELECT attempted.challenge_id, attempted.attempt_count, attempted.verified,
    verified_email.first_verified_at, verified_email.last_verified_at
FROM attempted
LEFT JOIN verified_email USING (professional_email_id);

-- name: PrepareHubProfilePictureUpload :one
WITH owner AS (
    SELECT u.hub_user_did
    FROM vetchium.hub_users AS u
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
      AND u.hub_plan_oid = ANY(sqlc.arg(entitled_plan_oids)::text[])
    FOR UPDATE
), inserted AS (
    INSERT INTO vetchium.hub_profile_picture_objects (
        object_id, hub_user_did, format, byte_size, width, height,
        content_sha256, upload_expires_at
    )
    SELECT sqlc.arg(object_id), owner.hub_user_did, sqlc.arg(format),
        sqlc.arg(byte_size), sqlc.arg(width), sqlc.arg(height),
        sqlc.arg(content_sha256), now() + interval '15 minutes'
    FROM owner
    RETURNING object_id, hub_user_did, format, byte_size, width, height,
        content_sha256, state, attempt_count, next_attempt_at, lease_token,
        leased_until, last_error, created_at, upload_expires_at,
        delete_requested_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.picture-upload-prepared',
        'hub_profile_picture', object_id::text, 'hub_user',
        hub_user_did::text, 'hub-api', sqlc.arg(idempotency_key),
        jsonb_build_object(
            'format', format, 'byte_size', byte_size,
            'width', width, 'height', height
        )
    FROM inserted
)
SELECT object_id, hub_user_did, format, byte_size, width, height,
    content_sha256, state, attempt_count, next_attempt_at, lease_token,
    leased_until, last_error, created_at, upload_expires_at,
    delete_requested_at
FROM inserted;

-- name: LockHubUserForPictureChange :exec
-- Run before the picture statements in each upload transaction. They lock the
-- owner inside CTEs that the planner may never scan (when no picture row
-- matches), and a statement that does wait keeps its pre-wait snapshot, missing
-- a concurrent upload's staged row.
SELECT 1
FROM vetchium.hub_users
WHERE hub_user_did = sqlc.arg(hub_user_did)
FOR UPDATE;

-- name: GetHubProfilePictureUpload :one
WITH owner AS MATERIALIZED (
    SELECT hub_user_did, hub_plan_oid
    FROM vetchium.hub_users
    WHERE hub_user_did = sqlc.arg(hub_user_did)
      AND hub_user_state = 'active'
    FOR UPDATE
)
SELECT p.state, p.content_sha256, p.upload_expires_at, u.hub_plan_oid
FROM vetchium.hub_profile_picture_objects AS p
JOIN owner AS u USING (hub_user_did)
WHERE p.object_id = sqlc.arg(object_id)
  AND p.hub_user_did = sqlc.arg(hub_user_did)
FOR UPDATE OF p;

-- name: SupersedeHubProfilePictureUploads :one
-- An in-flight PutObject is bounded to 30 seconds; delay deletion for one
-- minute so a superseded upload cannot recreate bytes after the worker deletes.
WITH owner AS (
    SELECT u.hub_user_did
    FROM vetchium.hub_users AS u
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
      AND u.hub_plan_oid = ANY(sqlc.arg(entitled_plan_oids)::text[])
    FOR UPDATE
), retired AS (
    UPDATE vetchium.hub_profile_picture_objects AS p
    SET state = 'pending_delete', upload_expires_at = NULL,
        delete_requested_at = now(),
        next_attempt_at = now() + interval '1 minute'
    FROM owner
    WHERE p.hub_user_did = owner.hub_user_did
      AND p.state = 'uploading'
      AND p.object_id <> sqlc.arg(object_id)
    RETURNING p.object_id, p.hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.picture-upload-superseded',
        'hub_profile_picture', object_id::text, 'hub_user',
        hub_user_did::text, 'hub-api', sqlc.arg(idempotency_key),
        '{}'::jsonb
    FROM retired
)
SELECT count(*)::integer AS retired_count FROM retired;

-- name: RetireHubProfilePictureForReplacement :many
-- Call before ActivateHubProfilePicture in the same transaction. PostgreSQL
-- does not order sibling data-modifying CTEs, so a single statement cannot
-- reliably vacate the active-user unique index before activating the new row.
WITH owner AS (
    SELECT u.hub_user_did
    FROM vetchium.hub_users AS u
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
      AND u.hub_plan_oid = ANY(sqlc.arg(entitled_plan_oids)::text[])
    FOR UPDATE
), candidate AS (
    SELECT p.object_id, p.hub_user_did
    FROM vetchium.hub_profile_picture_objects AS p
    JOIN owner USING (hub_user_did)
    WHERE p.object_id = sqlc.arg(object_id)
      AND p.state = 'uploading'
      AND p.upload_expires_at > now()
)
UPDATE vetchium.hub_profile_picture_objects AS old
SET state = 'pending_delete', delete_requested_at = now(),
    upload_expires_at = NULL, next_attempt_at = now() + interval '1 minute'
WHERE old.hub_user_did = (SELECT hub_user_did FROM candidate)
  AND old.state = 'active'
RETURNING old.object_id;

-- name: ActivateHubProfilePicture :one
WITH owner AS (
    SELECT u.hub_user_did
    FROM vetchium.hub_users AS u
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
      AND u.hub_plan_oid = ANY(sqlc.arg(entitled_plan_oids)::text[])
    FOR UPDATE
), candidate AS (
    SELECT p.object_id, p.hub_user_did
    FROM vetchium.hub_profile_picture_objects AS p
    JOIN owner USING (hub_user_did)
    WHERE p.object_id = sqlc.arg(object_id)
      AND p.state = 'uploading'
      AND p.upload_expires_at > now()
), activated AS (
    UPDATE vetchium.hub_profile_picture_objects AS p
    SET state = 'active', upload_expires_at = NULL
    WHERE p.object_id = (SELECT object_id FROM candidate)
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.hub_profile_picture_objects AS old
          WHERE old.hub_user_did = p.hub_user_did AND old.state = 'active'
      )
    RETURNING p.object_id, p.hub_user_did, p.format, p.byte_size, p.width,
        p.height, p.content_sha256, p.state, p.attempt_count,
        p.next_attempt_at, p.lease_token, p.leased_until, p.last_error,
        p.created_at, p.upload_expires_at, p.delete_requested_at
), versioned AS (
    UPDATE vetchium.hub_users AS u
    SET profile_version = profile_version + 1, updated_at = now()
    WHERE u.hub_user_did = (SELECT hub_user_did FROM activated)
    RETURNING profile_version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.picture-activated',
        'hub_profile_picture', object_id::text, 'hub_user',
        hub_user_did::text, 'hub-api', sqlc.arg(idempotency_key),
        jsonb_build_object('profile_version', versioned.profile_version)
    FROM activated CROSS JOIN versioned
)
SELECT activated.object_id, activated.hub_user_did, activated.format,
    activated.byte_size, activated.width, activated.height,
    activated.content_sha256, activated.state, activated.attempt_count,
    activated.next_attempt_at, activated.lease_token, activated.leased_until,
    activated.last_error, activated.created_at, activated.upload_expires_at,
    activated.delete_requested_at, versioned.profile_version
FROM activated CROSS JOIN versioned;

-- name: RemoveHubProfilePicture :one
WITH owner AS (
    SELECT u.hub_user_did
    FROM vetchium.hub_users AS u
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND u.hub_user_state = 'active'
    FOR UPDATE
), removed AS (
    UPDATE vetchium.hub_profile_picture_objects AS p
    SET state = 'pending_delete', delete_requested_at = now(),
        next_attempt_at = now() + interval '1 minute'
    FROM owner
    WHERE p.hub_user_did = owner.hub_user_did AND p.state = 'active'
    RETURNING p.object_id, p.hub_user_did
), versioned AS (
    UPDATE vetchium.hub_users AS u
    SET profile_version = profile_version + 1, updated_at = now()
    WHERE u.hub_user_did = (SELECT hub_user_did FROM removed)
    RETURNING profile_version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.picture-removed',
        'hub_profile_picture', object_id::text, 'hub_user',
        hub_user_did::text, 'hub-api', sqlc.arg(idempotency_key),
        jsonb_build_object('profile_version', versioned.profile_version)
    FROM removed CROSS JOIN versioned
)
SELECT removed.object_id, versioned.profile_version
FROM removed CROSS JOIN versioned;

-- name: QueueExpiredHubProfilePictureUploads :one
WITH expired AS (
    UPDATE vetchium.hub_profile_picture_objects
    SET state = 'pending_delete', upload_expires_at = NULL,
        delete_requested_at = now(),
        next_attempt_at = now() + interval '1 minute'
    WHERE state = 'uploading' AND upload_expires_at <= now()
    RETURNING object_id, hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.picture-upload-expired',
        'hub_profile_picture', object_id::text, 'worker', NULL,
        'workers', jsonb_build_object('hub_user_did', hub_user_did)
    FROM expired
)
SELECT count(*)::integer AS expired_count FROM expired;

-- name: ClaimHubProfilePictureDeletion :one
WITH candidate AS (
    SELECT object_id
    FROM vetchium.hub_profile_picture_objects
    WHERE state = 'pending_delete'
      AND next_attempt_at <= now()
      AND (leased_until IS NULL OR leased_until <= now())
    ORDER BY next_attempt_at, created_at, object_id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
), claimed AS (
    UPDATE vetchium.hub_profile_picture_objects AS p
    SET lease_token = sqlc.arg(lease_token),
        leased_until = now() + interval '1 minute',
        attempt_count = attempt_count + 1
    WHERE p.object_id = (SELECT object_id FROM candidate)
    RETURNING p.object_id, p.hub_user_did, p.format, p.byte_size, p.width,
        p.height, p.content_sha256, p.state, p.attempt_count,
        p.next_attempt_at, p.lease_token, p.leased_until, p.last_error,
        p.created_at, p.upload_expires_at, p.delete_requested_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.picture-deletion-claimed', 'hub_profile_picture',
        c.object_id::text, 'worker', NULL, 'workers',
        jsonb_build_object('hub_user_did', c.hub_user_did, 'attempt', c.attempt_count)
    FROM claimed AS c
)
SELECT object_id, hub_user_did, format, byte_size, width, height,
    content_sha256, state, attempt_count, next_attempt_at, lease_token,
    leased_until, last_error, created_at, upload_expires_at,
    delete_requested_at
FROM claimed;

-- The final SELECT's row count is the affected-row count.
-- name: RetryHubProfilePictureDeletion :execrows
WITH retried AS (
    UPDATE vetchium.hub_profile_picture_objects
    SET lease_token = NULL, leased_until = NULL,
        next_attempt_at = now() + LEAST(
            interval '5 minutes',
            interval '1 second' * power(2, LEAST(attempt_count, 8))
        ),
        last_error = left(sqlc.arg(last_error), 200)
    WHERE object_id = sqlc.arg(object_id)
      AND state = 'pending_delete'
      AND lease_token = sqlc.arg(lease_token)
    RETURNING object_id, hub_user_did, attempt_count
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.picture-deletion-retry-scheduled', 'hub_profile_picture',
        c.object_id::text, 'worker', NULL, 'workers',
        jsonb_build_object('hub_user_did', c.hub_user_did, 'attempt', c.attempt_count)
    FROM retried AS c
)
SELECT r.object_id FROM retried AS r;

-- name: CompleteHubProfilePictureDeletion :one
WITH deleted AS (
    DELETE FROM vetchium.hub_profile_picture_objects
    WHERE object_id = sqlc.arg(object_id)
      AND state = 'pending_delete'
      AND lease_token = sqlc.arg(lease_token)
    RETURNING object_id, hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.profile.picture-object-deleted',
        'hub_profile_picture', object_id::text, 'worker', NULL,
        'workers', jsonb_build_object('hub_user_did', hub_user_did)
    FROM deleted
)
SELECT object_id FROM deleted;
