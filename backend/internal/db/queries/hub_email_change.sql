-- name: SupersedeHubEmailChangeChallenges :execrows
-- Call before IssueHubEmailChangeChallenge in the same transaction.
-- Sibling data-modifying CTEs cannot reliably vacate the active-user index.
UPDATE vetchium.hub_email_change_challenges AS old
SET superseded_at = now()
WHERE old.hub_user_did = sqlc.arg(hub_user_did)
  AND old.consumed_at IS NULL
  AND old.superseded_at IS NULL
  AND old.attempt_count < 5;

-- While a live (non-terminal) account-email-change durable operation exists
-- for this user, request-email-change and confirm-email-change both refuse
-- outright (GU-ECH-001): neither issues nor supersedes a challenge.
-- name: HubAccountEmailChangeInProgress :one
SELECT EXISTS (
    SELECT 1 FROM vetchium.hub_account_email_changes
    WHERE hub_user_did = sqlc.arg(hub_user_did)
      AND state NOT IN ('succeeded', 'failed')
) AS in_progress;

-- Read-only lookup so the caller can compute the new address's global digest
-- (identitydigest lives in Go, not SQL) before calling AcceptHubEmailChange.
-- That statement re-validates every one of these conditions itself with
-- FOR UPDATE, so a plain read here cannot introduce a race: the address on
-- an already-created challenge row never changes.
-- name: GetHubEmailChangeChallengeAddress :one
SELECT new_email_address
FROM vetchium.hub_email_change_challenges
WHERE challenge_id = sqlc.arg(challenge_id)
  AND hub_user_did = sqlc.arg(hub_user_did)
  AND hub_session_id = sqlc.arg(hub_session_id)
  AND consumed_at IS NULL
  AND superseded_at IS NULL
  AND expires_at > now();

-- name: IssueHubEmailChangeChallenge :one
-- An address that already belongs to an account locally or globally still
-- gets a challenge, so rate limits and the response are identical, but no
-- code is queued for it (GU-ECH-001).
WITH account AS (
    SELECT u.hub_user_did, u.preferred_language
    FROM vetchium.hub_users AS u
    JOIN vetchium.hub_sessions AS s USING (hub_user_did)
    WHERE u.hub_user_did = sqlc.arg(hub_user_did)
      AND s.hub_session_id = sqlc.arg(hub_session_id)
      AND u.hub_user_state = 'active'
    FOR UPDATE OF u
), existing_user AS (
    SELECT 1
    FROM vetchium.hub_users AS taken
    WHERE taken.email_address = sqlc.arg(new_email_address)
), eligible AS (
    SELECT a.hub_user_did, a.preferred_language
    FROM account AS a
    WHERE NOT EXISTS (
          SELECT 1
          FROM vetchium.hub_email_change_challenges AS recent
          WHERE recent.hub_user_did = a.hub_user_did
            AND recent.created_at > now() - interval '60 seconds'
      )
      AND (
          SELECT count(*)
          FROM vetchium.hub_email_change_challenges AS hourly
          WHERE hourly.hub_user_did = a.hub_user_did
            AND hourly.created_at > now() - interval '1 hour'
      ) < 5
), inserted AS (
    INSERT INTO vetchium.hub_email_change_challenges (
        challenge_id, hub_user_did, hub_session_id, new_email_address,
        code_hash, expires_at
    )
    SELECT
        sqlc.arg(challenge_id),
        hub_user_did,
        sqlc.arg(hub_session_id),
        sqlc.arg(new_email_address),
        sqlc.arg(code_hash),
        now() + interval '10 minutes'
    FROM eligible
    RETURNING challenge_id, hub_user_did, expires_at
), outbox AS (
    INSERT INTO vetchium.hub_email_outbox (
        kind, recipient_email_address, preferred_language, payload_ciphertext
    )
    SELECT
        'email-change-verification',
        sqlc.arg(new_email_address),
        e.preferred_language,
        sqlc.arg(payload_ciphertext)
    FROM eligible AS e
    WHERE EXISTS (SELECT 1 FROM inserted)
      AND NOT EXISTS (SELECT 1 FROM existing_user)
      AND NOT sqlc.arg(globally_registered)::boolean
    RETURNING hub_email_outbox_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'hub.email-change.requested',
        'hub_user',
        i.hub_user_did::text,
        'hub_user',
        i.hub_user_did::text,
        'hub-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object(
            'challenge_id', i.challenge_id::text,
            'code_queued', EXISTS (SELECT 1 FROM outbox)
        )
    FROM inserted AS i
)
SELECT
    (CASE
        WHEN NOT EXISTS (SELECT 1 FROM account) THEN 'unauthenticated'
        WHEN NOT EXISTS (SELECT 1 FROM inserted) THEN 'rate_limited'
        ELSE 'issued'
    END)::text AS result,
    (SELECT i.expires_at FROM inserted AS i)::timestamptz AS expires_at;

-- name: AcceptHubEmailChange :one
-- Replaces the old ConfirmHubEmailChange (GU-ECH-002): a correct code no
-- longer applies the change directly. It creates the durable operation
-- (federation_operations, pollable, payload holds only the operation id)
-- and the richer hub_account_email_changes saga row in the same statement.
-- A unique violation on hub_account_email_changes_one_live (the caller
-- already has a live change) maps to the in-progress problem.
WITH candidate AS (
    SELECT
        c.challenge_id, c.hub_user_did, c.new_email_address, c.code_hash,
        u.email_digest AS old_email_digest
    FROM vetchium.hub_email_change_challenges AS c
    JOIN vetchium.hub_users AS u USING (hub_user_did)
    WHERE c.challenge_id = sqlc.arg(challenge_id)
      AND c.hub_user_did = sqlc.arg(hub_user_did)
      AND c.hub_session_id = sqlc.arg(hub_session_id)
      AND u.hub_user_state = 'active'
      AND c.consumed_at IS NULL
      AND c.superseded_at IS NULL
      AND c.expires_at > now()
      AND c.attempt_count < 5
    FOR UPDATE OF c, u
), attempted AS (
    UPDATE vetchium.hub_email_change_challenges AS c
    SET attempt_count = c.attempt_count + 1,
        consumed_at = CASE
            WHEN c.code_hash = sqlc.arg(code_hash) THEN now()
        END
    FROM candidate
    WHERE c.challenge_id = candidate.challenge_id
    RETURNING
        c.challenge_id,
        c.attempt_count,
        candidate.hub_user_did,
        candidate.new_email_address,
        candidate.old_email_digest,
        candidate.code_hash = sqlc.arg(code_hash) AS verified
), inserted_operation AS (
    INSERT INTO vetchium.federation_operations (
        operation_id, command_id, kind, target_authority, aggregate_id,
        owner_principal_type, owner_principal_id, idempotency_key,
        request_digest, payload_bytes, expires_at
    )
    SELECT
        sqlc.arg(operation_id), sqlc.arg(command_id),
        'hub-account-email-change', 'global-directory',
        a.hub_user_did::text, 'hub_user', a.hub_user_did::text,
        sqlc.arg(idempotency_key), sqlc.arg(request_digest),
        sqlc.arg(payload_bytes), sqlc.arg(operation_expires_at)
    FROM attempted AS a
    WHERE a.verified
    RETURNING operation_id
), inserted_change AS (
    INSERT INTO vetchium.hub_account_email_changes (
        operation_id, hub_user_did, new_email_address, new_email_digest,
        old_email_digest, confirming_session_id, reserve_command_id,
        finalize_command_id, abandon_command_id, not_after
    )
    SELECT
        io.operation_id, a.hub_user_did, a.new_email_address,
        sqlc.arg(new_email_digest), a.old_email_digest,
        sqlc.arg(hub_session_id), sqlc.arg(reserve_command_id),
        sqlc.arg(finalize_command_id), sqlc.arg(abandon_command_id),
        sqlc.arg(not_after)
    FROM attempted AS a
    CROSS JOIN inserted_operation AS io
    RETURNING operation_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        CASE WHEN a.verified THEN 'hub.email-change.accepted'
             ELSE 'hub.email-change.verification-failed' END,
        'hub_user', a.hub_user_did::text, 'hub_user', a.hub_user_did::text,
        'hub-api', sqlc.arg(idempotency_key),
        CASE WHEN a.verified
            THEN jsonb_build_object(
                'challenge_id', a.challenge_id::text,
                'operation_id', sqlc.arg(operation_id)
            )
            ELSE jsonb_build_object(
                'challenge_id', a.challenge_id::text,
                'attempt_count', a.attempt_count
            )
        END
    FROM attempted AS a
)
SELECT
    a.challenge_id, a.verified,
    (SELECT operation_id FROM inserted_change) AS operation_id
FROM attempted AS a;

-- name: GetHubAccountEmailChangeByOperationID :one
SELECT
    operation_id, hub_user_did, new_email_address, new_email_digest,
    old_email_digest, confirming_session_id, state, failure_reason,
    reserve_command_id, finalize_command_id, abandon_command_id, not_after
FROM vetchium.hub_account_email_changes
WHERE operation_id = sqlc.arg(operation_id)
  AND hub_user_did = sqlc.arg(hub_user_did);

-- name: LockHubAccountEmailChange :one
SELECT
    operation_id, hub_user_did, new_email_address, new_email_digest,
    old_email_digest, confirming_session_id, state, failure_reason,
    reserve_command_id, finalize_command_id, abandon_command_id, not_after
FROM vetchium.hub_account_email_changes
WHERE operation_id = sqlc.arg(operation_id)
FOR UPDATE;

-- The final SELECT's row count is the affected-row count.
-- name: MarkHubAccountEmailChangeReserved :execrows
WITH changed AS (
    UPDATE vetchium.hub_account_email_changes
    SET state = 'reserved', updated_at = now()
    WHERE operation_id = sqlc.arg(operation_id)
      AND state = 'accepted'
    RETURNING operation_id, hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'hub.email-change.reserved', 'hub_user',
        c.hub_user_did::text, 'hub_user', c.hub_user_did::text,
        sqlc.arg(source), c.operation_id::text, '{}'::jsonb
    FROM changed AS c
)
SELECT c.operation_id FROM changed AS c;

-- The reserve-time email-claim-conflict path (GU-ECH-003): fails directly,
-- skipping 'cancelling', since nothing was reserved globally to undo. The
-- caller resolves the sibling federation_operations row with the existing
-- generic ResolveFederationOperation in the same transaction.
-- name: FailHubAccountEmailChangeDirectly :execrows
WITH updated_change AS (
    UPDATE vetchium.hub_account_email_changes
    SET state = 'failed', failure_reason = sqlc.arg(failure_reason),
        completed_at = now(), updated_at = now()
    WHERE operation_id = sqlc.arg(operation_id)
      AND state = 'accepted'
    RETURNING operation_id
)
INSERT INTO vetchium.audit_events (
    tenant_id, action, entity_type, entity_id, actor_type, actor_id,
    source, idempotency_key, payload
)
SELECT
    sqlc.arg(tenant_id), 'hub.email-change.rejected', 'hub_user',
    sqlc.arg(hub_user_did)::text, 'hub_user',
    sqlc.arg(hub_user_did)::text, sqlc.arg(source),
    sqlc.arg(idempotency_key),
    jsonb_build_object('reason', sqlc.arg(failure_reason)::text)
FROM updated_change;

-- The final SELECT's row count is the affected-row count.
-- name: MarkHubAccountEmailChangeCancelling :execrows
WITH changed AS (
    UPDATE vetchium.hub_account_email_changes
    SET state = 'cancelling', failure_reason = sqlc.arg(failure_reason),
        updated_at = now()
    WHERE operation_id = sqlc.arg(operation_id)
      AND state IN ('accepted', 'reserved')
    RETURNING operation_id, hub_user_did, failure_reason
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'hub.email-change.cancelling', 'hub_user',
        c.hub_user_did::text, 'hub_user', c.hub_user_did::text,
        sqlc.arg(source), c.operation_id::text, jsonb_build_object('reason', c.failure_reason)
    FROM changed AS c
)
SELECT c.operation_id FROM changed AS c;

-- Applies the change locally: this is today's ConfirmHubEmailChange effects,
-- minus the code check, reading everything from hub_account_email_changes.
-- The confirming session is preserved unless it no longer exists, in which
-- case every session is revoked (GU-ECH-002a).
-- name: ApplyHubAccountEmailChange :one
WITH locked_change AS (
    SELECT change.operation_id, change.hub_user_did,
        change.new_email_address, change.new_email_digest,
        change.confirming_session_id
    FROM vetchium.hub_account_email_changes AS change
    WHERE change.operation_id = sqlc.arg(operation_id)
      AND change.state = 'reserved'
    FOR UPDATE
), previous_user AS (
    SELECT hub_user_did, email_address, preferred_language
    FROM vetchium.hub_users
    WHERE hub_user_did = (SELECT hub_user_did FROM locked_change)
), changed_user AS (
    UPDATE vetchium.hub_users AS u
    SET email_address = lc.new_email_address,
        email_digest = lc.new_email_digest, updated_at = now()
    FROM locked_change AS lc
    WHERE u.hub_user_did = lc.hub_user_did
    RETURNING u.hub_user_did
), updated_change AS (
    UPDATE vetchium.hub_account_email_changes AS change
    SET state = 'applied', updated_at = now()
    FROM changed_user
    WHERE change.operation_id = sqlc.arg(operation_id)
      AND change.state = 'reserved'
      AND change.hub_user_did = changed_user.hub_user_did
    RETURNING change.operation_id
), sessions AS (
    DELETE FROM vetchium.hub_sessions
    WHERE hub_user_did IN (SELECT hub_user_did FROM changed_user)
      AND hub_session_id <>
          (SELECT confirming_session_id FROM locked_change)
), login_challenges AS (
    UPDATE vetchium.hub_login_challenges
    SET active = false
    WHERE hub_user_did IN (SELECT hub_user_did FROM changed_user)
      AND active
), resets AS (
    UPDATE vetchium.hub_password_reset_tokens
    SET active = false
    WHERE hub_user_did IN (SELECT hub_user_did FROM changed_user)
      AND active
), notice AS (
    INSERT INTO vetchium.hub_email_outbox (
        kind, recipient_email_address, preferred_language, payload_ciphertext
    )
    SELECT 'email-changed', pu.email_address, pu.preferred_language,
        sqlc.arg(notice_payload_ciphertext)
    FROM previous_user AS pu
    WHERE EXISTS (SELECT 1 FROM changed_user)
    RETURNING hub_email_outbox_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'hub.email.changed', 'hub_user',
        cu.hub_user_did::text, 'hub_user', cu.hub_user_did::text,
        sqlc.arg(source), sqlc.arg(idempotency_key),
        jsonb_build_object(
            'changed_fields', jsonb_build_array('email_address'),
            'other_sessions_revoked', true,
            'previous_address_notified', EXISTS (SELECT 1 FROM notice)
        )
    FROM changed_user AS cu
)
SELECT operation_id FROM updated_change;

-- The caller resolves the sibling federation_operations row with the
-- existing generic ResolveFederationOperation in the same transaction.
-- The final SELECT's row count is the affected-row count.
-- name: MarkHubAccountEmailChangeSucceeded :execrows
WITH changed AS (
    UPDATE vetchium.hub_account_email_changes
    SET state = 'succeeded', completed_at = now(), updated_at = now()
    WHERE operation_id = sqlc.arg(operation_id)
      AND state = 'applied'
    RETURNING operation_id, hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id), 'hub.email-change.succeeded', 'hub_user',
        c.hub_user_did::text, 'hub_user', c.hub_user_did::text,
        sqlc.arg(source), c.operation_id::text, '{}'::jsonb
    FROM changed AS c
)
SELECT c.operation_id FROM changed AS c;

-- name: MarkHubAccountEmailChangeFailed :execrows
WITH updated_change AS (
    UPDATE vetchium.hub_account_email_changes
    SET state = 'failed', completed_at = now(), updated_at = now()
    WHERE operation_id = sqlc.arg(operation_id)
      AND state = 'cancelling'
    RETURNING operation_id
)
INSERT INTO vetchium.audit_events (
    tenant_id, action, entity_type, entity_id, actor_type, actor_id,
    source, idempotency_key, payload
)
SELECT
    sqlc.arg(tenant_id), 'hub.email-change.rejected', 'hub_user',
    sqlc.arg(hub_user_did)::text, 'hub_user',
    sqlc.arg(hub_user_did)::text, sqlc.arg(source),
    sqlc.arg(idempotency_key),
    jsonb_build_object('reason', sqlc.arg(failure_reason)::text)
FROM updated_change;

-- The sibling operation's retry schedule orders recovery, so a batch of
-- changes stuck on an unreachable directory backs off instead of starving
-- every later change.
-- name: ListRecoverableHubAccountEmailChanges :many
SELECT
    change.operation_id, change.hub_user_did, change.new_email_address,
    change.new_email_digest, change.old_email_digest,
    change.confirming_session_id, change.state, change.failure_reason,
    change.reserve_command_id, change.finalize_command_id,
    change.abandon_command_id, change.not_after
FROM vetchium.hub_account_email_changes AS change
INNER JOIN vetchium.federation_operations AS operation
    ON operation.operation_id = change.operation_id
WHERE change.state NOT IN ('succeeded', 'failed')
  AND operation.state = 'pending'
  AND operation.next_attempt_at <= now()
ORDER BY operation.next_attempt_at, operation.created_at, operation.operation_id
LIMIT sqlc.arg(batch_size);
