-- One-way blocks and mutes between Hub users (agent-guides/posts.md, Blocks
-- and mutes). The blocker's or muter's tenant holds them. A write that runs
-- alone carries its audit event; the audit never holds words.

-- name: InsertHubUserBlock :one
WITH inserted AS (
    INSERT INTO vetchium.hub_user_blocks (
        blocker_hub_user_did, blocked_hub_user_did, blocked_handle,
        blocked_tenant_id
    )
    VALUES (
        sqlc.arg(blocker_hub_user_did), sqlc.arg(blocked_hub_user_did),
        sqlc.arg(blocked_handle), sqlc.arg(blocked_tenant_id)
    )
    ON CONFLICT (blocker_hub_user_did, blocked_hub_user_did) DO NOTHING
    RETURNING blocker_hub_user_did, blocked_hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.block.created', 'hub_user_block',
        inserted.blocked_hub_user_did::text, 'hub_user',
        inserted.blocker_hub_user_did::text, inserted.blocker_hub_user_did,
        'hub-api', sqlc.narg(idempotency_key)::text,
        jsonb_build_object('schema_version', 1)
    FROM inserted
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM inserted)::bigint AS inserted_rows,
    (SELECT count(*) FROM audit)::bigint AS audit_rows;

-- name: DeleteHubUserBlock :one
WITH deleted AS (
    DELETE FROM vetchium.hub_user_blocks AS r
    WHERE r.blocker_hub_user_did = sqlc.arg(blocker_hub_user_did)
      AND r.blocked_hub_user_did = sqlc.arg(blocked_hub_user_did)
    RETURNING r.blocker_hub_user_did, r.blocked_hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.block.deleted', 'hub_user_block',
        deleted.blocked_hub_user_did::text, 'hub_user',
        deleted.blocker_hub_user_did::text, deleted.blocker_hub_user_did,
        'hub-api', sqlc.narg(idempotency_key)::text,
        jsonb_build_object('schema_version', 1)
    FROM deleted
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM deleted)::bigint AS deleted_rows,
    (SELECT count(*) FROM audit)::bigint AS audit_rows;

-- name: ListHubUserBlocks :many
SELECT r.blocked_hub_user_did, r.blocked_handle, r.blocked_tenant_id,
    r.created_at
FROM vetchium.hub_user_blocks AS r
WHERE r.blocker_hub_user_did = sqlc.arg(blocker_hub_user_did)
  AND (
        sqlc.narg(before_created_at)::timestamptz IS NULL
        OR (r.created_at, r.blocked_hub_user_did) < (
            sqlc.narg(before_created_at)::timestamptz,
            sqlc.narg(before_blocked_hub_user_did)::uuid
        )
    )
ORDER BY r.created_at DESC, r.blocked_hub_user_did DESC
LIMIT sqlc.arg(page_limit);

-- name: HubUserBlockExists :one
SELECT EXISTS (
    SELECT 1 FROM vetchium.hub_user_blocks AS r
    WHERE r.blocker_hub_user_did = sqlc.arg(blocker_hub_user_did)
      AND r.blocked_hub_user_did = sqlc.arg(blocked_hub_user_did)
) AS block_exists;

-- name: HubUserBlockedAny :many
SELECT r.blocked_hub_user_did
FROM vetchium.hub_user_blocks AS r
WHERE r.blocker_hub_user_did = sqlc.arg(blocker_hub_user_did)
  AND r.blocked_hub_user_did = ANY(sqlc.arg(candidate_dids)::uuid[]);

-- name: InsertHubUserMute :one
WITH inserted AS (
    INSERT INTO vetchium.hub_user_mutes (
        muter_hub_user_did, muted_hub_user_did, muted_handle,
        muted_tenant_id
    )
    VALUES (
        sqlc.arg(muter_hub_user_did), sqlc.arg(muted_hub_user_did),
        sqlc.arg(muted_handle), sqlc.arg(muted_tenant_id)
    )
    ON CONFLICT (muter_hub_user_did, muted_hub_user_did) DO NOTHING
    RETURNING muter_hub_user_did, muted_hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.mute.created', 'hub_user_mute',
        inserted.muted_hub_user_did::text, 'hub_user',
        inserted.muter_hub_user_did::text, inserted.muter_hub_user_did,
        'hub-api', sqlc.narg(idempotency_key)::text,
        jsonb_build_object('schema_version', 1)
    FROM inserted
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM inserted)::bigint AS inserted_rows,
    (SELECT count(*) FROM audit)::bigint AS audit_rows;

-- name: DeleteHubUserMute :one
WITH deleted AS (
    DELETE FROM vetchium.hub_user_mutes AS r
    WHERE r.muter_hub_user_did = sqlc.arg(muter_hub_user_did)
      AND r.muted_hub_user_did = sqlc.arg(muted_hub_user_did)
    RETURNING r.muter_hub_user_did, r.muted_hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.mute.deleted', 'hub_user_mute',
        deleted.muted_hub_user_did::text, 'hub_user',
        deleted.muter_hub_user_did::text, deleted.muter_hub_user_did,
        'hub-api', sqlc.narg(idempotency_key)::text,
        jsonb_build_object('schema_version', 1)
    FROM deleted
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM deleted)::bigint AS deleted_rows,
    (SELECT count(*) FROM audit)::bigint AS audit_rows;

-- name: ListHubUserMutes :many
SELECT r.muted_hub_user_did, r.muted_handle, r.muted_tenant_id,
    r.created_at
FROM vetchium.hub_user_mutes AS r
WHERE r.muter_hub_user_did = sqlc.arg(muter_hub_user_did)
  AND (
        sqlc.narg(before_created_at)::timestamptz IS NULL
        OR (r.created_at, r.muted_hub_user_did) < (
            sqlc.narg(before_created_at)::timestamptz,
            sqlc.narg(before_muted_hub_user_did)::uuid
        )
    )
ORDER BY r.created_at DESC, r.muted_hub_user_did DESC
LIMIT sqlc.arg(page_limit);

-- name: HubUserMuteExists :one
SELECT EXISTS (
    SELECT 1 FROM vetchium.hub_user_mutes AS r
    WHERE r.muter_hub_user_did = sqlc.arg(muter_hub_user_did)
      AND r.muted_hub_user_did = sqlc.arg(muted_hub_user_did)
) AS mute_exists;

-- name: HubUserMutedAny :many
SELECT r.muted_hub_user_did
FROM vetchium.hub_user_mutes AS r
WHERE r.muter_hub_user_did = sqlc.arg(muter_hub_user_did)
  AND r.muted_hub_user_did = ANY(sqlc.arg(candidate_dids)::uuid[]);
