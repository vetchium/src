-- Hub timeline posts (agent-guides/posts.md, Posts). The author's tenant holds
-- the words. A write that runs alone carries its audit event; the audit never
-- holds words.

-- Serializes one author's creates so the daily cap and the insert agree
-- (PST-POS-003). The caller reads the plan from the returned row.
-- name: LockHubUserForPosting :one
SELECT u.hub_user_did, u.hub_plan_oid
FROM vetchium.hub_users AS u
WHERE u.hub_user_did = sqlc.arg(hub_user_did)
  AND u.hub_user_state = 'active'
FOR UPDATE;

-- name: CountHubPostsSince :one
SELECT count(*)::bigint AS post_count
FROM vetchium.hub_posts AS p
WHERE p.author_hub_user_did = sqlc.arg(author_hub_user_did)
  AND p.created_at > sqlc.arg(since)::timestamptz;

-- Creates a top-level post (PST-POS-001). Zero inserted rows means the plan
-- refused: the plan gate sits in the statement, not in the caller.
-- name: InsertHubPost :one
WITH inserted AS (
    INSERT INTO vetchium.hub_posts (
        post_id, author_hub_user_did, kind, body, reply_policy, quote_policy
    )
    SELECT sqlc.arg(post_id), u.hub_user_did, 'post', sqlc.arg(body),
        sqlc.arg(reply_policy), sqlc.arg(quote_policy)
    FROM vetchium.hub_users AS u
    WHERE u.hub_user_did = sqlc.arg(author_hub_user_did)
      AND u.hub_user_state = 'active'
      AND u.hub_plan_oid = ANY(sqlc.arg(entitled_plan_oids)::text[])
    RETURNING post_id, author_hub_user_did, kind
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.post.created', 'hub_post',
        inserted.post_id, 'hub_user', inserted.author_hub_user_did::text,
        inserted.author_hub_user_did, 'hub-api',
        sqlc.narg(idempotency_key)::text,
        jsonb_build_object('schema_version', 1, 'kind', inserted.kind)
    FROM inserted
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM inserted)::bigint AS inserted_rows,
    (SELECT count(*) FROM audit)::bigint AS audit_rows;

-- Edits a live post inside its 30-minute window (PST-POS-006). It keeps the
-- old body as a revision in the same statement. Zero updated rows means a
-- condition failed; GetHubPostEditState tells which one.
-- name: EditHubPost :one
WITH target AS (
    SELECT p.post_id, p.author_hub_user_did, p.body, p.revision
    FROM vetchium.hub_posts AS p
    WHERE p.post_id = sqlc.arg(post_id)
      AND p.author_hub_user_did = sqlc.arg(author_hub_user_did)
      AND p.state = 'live'
      AND p.revision = sqlc.arg(revision)::integer
      AND p.created_at > now() - interval '30 minutes'
      AND (
            p.kind <> 'post'
            OR EXISTS (
                SELECT 1 FROM vetchium.hub_users AS u
                WHERE u.hub_user_did = p.author_hub_user_did
                  AND u.hub_plan_oid = ANY(sqlc.arg(entitled_plan_oids)::text[])
            )
        )
    FOR UPDATE
), kept AS (
    INSERT INTO vetchium.hub_post_revisions (post_id, revision, body)
    SELECT target.post_id, target.revision, target.body FROM target
    RETURNING post_id
), updated AS (
    UPDATE vetchium.hub_posts AS p
    SET body = sqlc.arg(body), revision = p.revision + 1,
        version = p.version + 1, edited_at = now()
    FROM target
    WHERE p.post_id = target.post_id
    RETURNING p.post_id, p.author_hub_user_did, p.revision, p.version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.post.edited', 'hub_post',
        updated.post_id, 'hub_user', updated.author_hub_user_did::text,
        updated.author_hub_user_did, 'hub-api',
        sqlc.narg(idempotency_key)::text,
        jsonb_build_object('schema_version', 1, 'revision', updated.revision)
    FROM updated
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM updated)::bigint AS updated_rows,
    (SELECT count(*) FROM kept)::bigint AS kept_rows,
    (SELECT count(*) FROM audit)::bigint AS audit_rows;

-- Tells the handler why EditHubPost changed no row. window_open uses the
-- database clock, as the edit does.
-- name: GetHubPostEditState :one
SELECT p.kind, p.state, p.revision, p.version,
    (p.created_at > now() - interval '30 minutes') AS window_open,
    (u.hub_plan_oid = ANY(sqlc.arg(entitled_plan_oids)::text[])) AS plan_entitled
FROM vetchium.hub_posts AS p
JOIN vetchium.hub_users AS u ON u.hub_user_did = p.author_hub_user_did
WHERE p.post_id = sqlc.arg(post_id)
  AND p.author_hub_user_did = sqlc.arg(author_hub_user_did);

-- Removal clears the words and the revisions in one statement (PST-POS-007).
-- name: RemoveHubPost :one
WITH target AS (
    SELECT p.post_id
    FROM vetchium.hub_posts AS p
    WHERE p.post_id = sqlc.arg(post_id)
      AND p.author_hub_user_did = sqlc.arg(author_hub_user_did)
      AND p.state = 'live'
    FOR UPDATE
), removed AS (
    UPDATE vetchium.hub_posts AS p
    SET state = 'removed', body = NULL, removed_at = now(),
        version = p.version + 1
    FROM target
    WHERE p.post_id = target.post_id
    RETURNING p.post_id, p.author_hub_user_did, p.kind, p.version
), cleared AS (
    DELETE FROM vetchium.hub_post_revisions AS r
    USING removed
    WHERE r.post_id = removed.post_id
    RETURNING r.post_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.post.removed', 'hub_post',
        removed.post_id, 'hub_user', removed.author_hub_user_did::text,
        removed.author_hub_user_did, 'hub-api',
        sqlc.narg(idempotency_key)::text,
        jsonb_build_object('schema_version', 1, 'kind', removed.kind)
    FROM removed
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM removed)::bigint AS removed_rows,
    (SELECT count(*) FROM audit)::bigint AS audit_rows;

-- Changes the policies and the lock of a live post (PST-POS-005). A post that
-- stays locked keeps its first lock time.
-- name: SetHubPostPolicies :one
WITH updated AS (
    UPDATE vetchium.hub_posts AS p
    SET reply_policy = sqlc.arg(reply_policy),
        quote_policy = sqlc.arg(quote_policy),
        locked_at = CASE
            WHEN sqlc.arg(locked)::boolean THEN COALESCE(p.locked_at, now())
        END,
        version = p.version + 1
    WHERE p.post_id = sqlc.arg(post_id)
      AND p.author_hub_user_did = sqlc.arg(author_hub_user_did)
      AND p.state = 'live'
    RETURNING p.post_id, p.author_hub_user_did, p.reply_policy,
        p.quote_policy, p.locked_at, p.version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.post.policies-changed', 'hub_post',
        updated.post_id, 'hub_user', updated.author_hub_user_did::text,
        updated.author_hub_user_did, 'hub-api',
        sqlc.narg(idempotency_key)::text,
        jsonb_build_object('schema_version', 1,
            'reply_policy', updated.reply_policy,
            'quote_policy', updated.quote_policy,
            'locked', updated.locked_at IS NOT NULL)
    FROM updated
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM updated)::bigint AS updated_rows,
    (SELECT count(*) FROM audit)::bigint AS audit_rows;

-- name: ListHubPostsByAuthor :many
SELECT p.post_id, p.kind, p.body, p.reply_policy, p.quote_policy,
    p.locked_at, p.reply_count, p.quote_count, p.revision, p.version,
    p.created_at, p.edited_at
FROM vetchium.hub_posts AS p
WHERE p.author_hub_user_did = sqlc.arg(author_hub_user_did)
  AND p.state = 'live'
  AND (
        sqlc.narg(before_created_at)::timestamptz IS NULL
        OR (p.created_at, p.post_id) < (
            sqlc.narg(before_created_at)::timestamptz,
            sqlc.narg(before_post_id)::text COLLATE "C"
        )
    )
ORDER BY p.created_at DESC, p.post_id DESC
LIMIT sqlc.arg(page_limit);

-- name: GetHubPostsByIDs :many
SELECT p.post_id, p.kind, p.body, p.reply_policy, p.quote_policy,
    p.locked_at, p.reply_count, p.quote_count, p.revision, p.version,
    p.created_at, p.edited_at
FROM vetchium.hub_posts AS p
WHERE p.author_hub_user_did = sqlc.arg(author_hub_user_did)
  AND p.post_id = ANY(sqlc.arg(post_ids)::text[])
  AND p.state = 'live';
