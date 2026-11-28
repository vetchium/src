-- Hub post replies (agent-guides/posts.md, Replies). The reply author's tenant
-- holds the words (hub_reply_texts); the post owner's tenant holds the
-- structure and the reply copy (hub_post_replies). A query that always runs
-- beside an audited statement (a federation hook, a handler, a worker job)
-- carries no audit CTE; the caller writes the event. The audit never holds
-- words.

-- Writes one audit event for a statement that carries no audit CTE. The
-- payload never holds words.
-- name: InsertHubPostAuditEvent :exec
INSERT INTO vetchium.audit_events (
    tenant_id, action, entity_type, entity_id, actor_type, actor_id,
    subject_hub_user_did, source, idempotency_key, payload
)
VALUES (
    sqlc.arg(tenant_id), sqlc.arg(action)::text, sqlc.arg(entity_type)::text,
    sqlc.arg(entity_id)::text, sqlc.arg(actor_type)::text,
    sqlc.arg(actor_id)::text, sqlc.arg(subject_hub_user_did), sqlc.arg(source)::text,
    sqlc.narg(idempotency_key)::text, sqlc.arg(payload)::jsonb
);

-- ---------------------------------------------------------------------------
-- Replier side
-- ---------------------------------------------------------------------------

-- name: CountHubRepliesSince :one
SELECT count(*)::bigint AS reply_count
FROM vetchium.hub_reply_texts AS r
WHERE r.author_hub_user_did = sqlc.arg(author_hub_user_did)
  AND r.created_at > sqlc.arg(since)::timestamptz;

-- name: InsertPendingHubReplyText :exec
INSERT INTO vetchium.hub_reply_texts (
    reply_id, author_hub_user_did, post_owner_hub_user_did,
    post_owner_handle, post_owner_tenant_id, post_id, parent_reply_id,
    operation_id, body, state
)
VALUES (
    sqlc.arg(reply_id), sqlc.arg(author_hub_user_did),
    sqlc.arg(post_owner_hub_user_did), sqlc.arg(post_owner_handle),
    sqlc.arg(post_owner_tenant_id), sqlc.arg(post_id),
    sqlc.narg(parent_reply_id), sqlc.arg(operation_id), sqlc.arg(body),
    'pending'
);

-- Settles one pending reply (PST-RPL-008). Zero rows means the row is gone or
-- no longer pending.
-- name: SettleHubReplyTextLive :execrows
UPDATE vetchium.hub_reply_texts AS r
SET state = 'live', operation_id = NULL
WHERE r.operation_id = sqlc.arg(operation_id)
  AND r.state = 'pending';

-- name: DeletePendingHubReplyText :execrows
DELETE FROM vetchium.hub_reply_texts AS r
WHERE r.operation_id = sqlc.arg(operation_id)
  AND r.state = 'pending';

-- Everything the edit, remove, and Replies tab handlers need to route one
-- reply of this author. window_open uses the database clock, as the edit does.
-- name: GetHubReplyText :one
SELECT r.reply_id, r.post_id, r.parent_reply_id, r.post_owner_hub_user_did,
    r.post_owner_handle, r.post_owner_tenant_id, r.body, r.state,
    r.revision, r.version, r.created_at, r.edited_at,
    (r.created_at > now() - interval '30 minutes') AS window_open
FROM vetchium.hub_reply_texts AS r
WHERE r.reply_id = sqlc.arg(reply_id)
  AND r.author_hub_user_did = sqlc.arg(author_hub_user_did);

-- Edits a live reply inside its 30-minute window (PST-RPL-010). It keeps the
-- old body as a revision in the same statement. Zero updated rows means a
-- condition failed; GetHubReplyText tells which one.
-- name: EditHubReplyText :one
WITH target AS (
    SELECT r.reply_id, r.author_hub_user_did, r.body, r.revision
    FROM vetchium.hub_reply_texts AS r
    WHERE r.reply_id = sqlc.arg(reply_id)
      AND r.author_hub_user_did = sqlc.arg(author_hub_user_did)
      AND r.state = 'live'
      AND r.revision = sqlc.arg(revision)::integer
      AND r.created_at > now() - interval '30 minutes'
    FOR UPDATE
), kept AS (
    INSERT INTO vetchium.hub_reply_revisions (reply_id, revision, body)
    SELECT target.reply_id, target.revision, target.body FROM target
    RETURNING reply_id
), updated AS (
    UPDATE vetchium.hub_reply_texts AS r
    SET body = sqlc.arg(body), revision = r.revision + 1,
        version = r.version + 1, edited_at = now()
    FROM target
    WHERE r.reply_id = target.reply_id
    RETURNING r.reply_id, r.author_hub_user_did, r.revision, r.version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.reply.edited', 'hub_reply',
        updated.reply_id, 'hub_user', updated.author_hub_user_did::text,
        updated.author_hub_user_did, 'hub-api',
        sqlc.narg(idempotency_key)::text,
        jsonb_build_object('schema_version', 1, 'revision', updated.revision)
    FROM updated
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM updated)::bigint AS updated_rows,
    (SELECT count(*) FROM kept)::bigint AS kept_rows,
    (SELECT count(*) FROM audit)::bigint AS audit_rows,
    COALESCE((SELECT max(updated.revision) FROM updated), 0)::integer
        AS new_revision,
    COALESCE((SELECT max(updated.version) FROM updated), 0)::bigint
        AS new_version;

-- Removal clears the words and the revisions in one statement (PST-RPL-011).
-- A reply on a removed post can go too. was_live tells the caller whether the
-- post owner's tenant still holds a copy to clear.
-- name: RemoveHubReplyText :one
WITH target AS (
    SELECT r.reply_id, r.state AS old_state
    FROM vetchium.hub_reply_texts AS r
    WHERE r.reply_id = sqlc.arg(reply_id)
      AND r.author_hub_user_did = sqlc.arg(author_hub_user_did)
      AND r.state IN ('live', 'post_removed')
    FOR UPDATE
), removed AS (
    UPDATE vetchium.hub_reply_texts AS r
    SET state = 'removed', body = NULL, removed_at = now(),
        version = r.version + 1
    FROM target
    WHERE r.reply_id = target.reply_id
    RETURNING r.reply_id, r.author_hub_user_did, r.version
), cleared AS (
    DELETE FROM vetchium.hub_reply_revisions AS v
    USING removed
    WHERE v.reply_id = removed.reply_id
    RETURNING v.reply_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.reply.removed', 'hub_reply',
        removed.reply_id, 'hub_user', removed.author_hub_user_did::text,
        removed.author_hub_user_did, 'hub-api',
        sqlc.narg(idempotency_key)::text,
        jsonb_build_object('schema_version', 1)
    FROM removed
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM removed)::bigint AS removed_rows,
    (SELECT count(*) FROM audit)::bigint AS audit_rows,
    COALESCE((SELECT max(removed.version) FROM removed), 0)::bigint
        AS new_version,
    EXISTS (SELECT 1 FROM target WHERE target.old_state = 'live')::boolean
        AS was_live;

-- The receiver of hub-post-removed (PST-RPL-013). Only pending and live
-- replies change; the operation ID goes with the pending state.
-- name: MarkHubRepliesPostRemoved :execrows
UPDATE vetchium.hub_reply_texts AS r
SET state = 'post_removed', operation_id = NULL
WHERE r.author_hub_user_did = sqlc.arg(author_hub_user_did)
  AND r.post_owner_hub_user_did = sqlc.arg(post_owner_hub_user_did)
  AND r.post_id = sqlc.arg(post_id)
  AND r.state IN ('pending', 'live');

-- The Replies tab (PST-TAB-001, PST-TAB-003). A post_removed row returns no
-- words.
-- name: ListHubReplyTextsByAuthor :many
SELECT r.reply_id, r.post_id, r.parent_reply_id, r.post_owner_handle,
    r.post_owner_tenant_id, r.state,
    words.body,
    r.revision, r.version, r.created_at, r.edited_at
FROM vetchium.hub_reply_texts AS r
LEFT JOIN vetchium.hub_reply_texts AS words
    ON words.reply_id = r.reply_id AND words.state = 'live'
WHERE r.author_hub_user_did = sqlc.arg(author_hub_user_did)
  AND r.state IN ('live', 'post_removed')
  AND (
        sqlc.narg(before_created_at)::timestamptz IS NULL
        OR (r.created_at, r.reply_id) < (
            sqlc.narg(before_created_at)::timestamptz,
            sqlc.narg(before_reply_id)::text COLLATE "C"
        )
    )
ORDER BY r.created_at DESC, r.reply_id DESC
LIMIT sqlc.arg(page_limit);

-- Pending replies whose operation is past expires_at (PST-RPL-009).
-- name: ListExpiredPendingHubReplyTexts :many
SELECT r.reply_id, r.author_hub_user_did, r.operation_id
FROM vetchium.hub_reply_texts AS r
JOIN vetchium.federation_operations AS o ON o.operation_id = r.operation_id
WHERE r.state = 'pending'
  AND o.expires_at < now()
ORDER BY o.expires_at, r.reply_id
LIMIT sqlc.arg(page_limit);

-- The reaper deletes only rows that are still pending. One audit event for
-- each deleted row; the audit never holds words. It returns the deleted rows,
-- so the caller tells each post owner (PST-RPL-009).
-- name: DeleteHubReplyTextsByIDs :many
WITH deleted AS (
    DELETE FROM vetchium.hub_reply_texts AS r
    WHERE r.reply_id = ANY(sqlc.arg(reply_ids)::text[])
      AND r.state = 'pending'
    RETURNING r.reply_id, r.author_hub_user_did, r.post_owner_hub_user_did,
        r.post_id, r.version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.reply.pending-reaped', 'hub_reply',
        deleted.reply_id, 'worker', 'workers', deleted.author_hub_user_did,
        'workers', jsonb_build_object('schema_version', 1)
    FROM deleted
    RETURNING audit_event_id
)
SELECT deleted.reply_id, deleted.author_hub_user_did,
    deleted.post_owner_hub_user_did, deleted.post_id, deleted.version,
    (SELECT count(*) FROM audit)::bigint AS audit_rows
FROM deleted
ORDER BY deleted.reply_id;

-- ---------------------------------------------------------------------------
-- Post owner side
-- ---------------------------------------------------------------------------

-- Locks the post for one reply command (PST-RPL-003, PST-RPL-007).
-- name: GetHubPostForReply :one
SELECT p.post_id, p.author_hub_user_did, p.state, p.locked_at,
    p.reply_policy, p.reply_count
FROM vetchium.hub_posts AS p
WHERE p.post_id = sqlc.arg(post_id)
FOR UPDATE;

-- name: GetHubPostReplyForUpdate :one
SELECT r.post_id, r.reply_id, r.parent_reply_id, r.author_hub_user_did,
    r.author_handle, r.author_tenant_id, r.body, r.revision, r.state,
    r.child_count, r.child_row_count, r.created_at
FROM vetchium.hub_post_replies AS r
WHERE r.post_id = sqlc.arg(post_id)
  AND r.reply_id = sqlc.arg(reply_id)
FOR UPDATE;

-- A redelivered command inserts nothing; zero rows tells the caller to skip
-- the count change.
-- name: InsertHubPostReply :execrows
INSERT INTO vetchium.hub_post_replies (
    post_id, reply_id, parent_reply_id, author_hub_user_did, author_handle,
    author_tenant_id, body
)
VALUES (
    sqlc.arg(post_id), sqlc.arg(reply_id), sqlc.narg(parent_reply_id),
    sqlc.arg(author_hub_user_did), sqlc.arg(author_handle),
    sqlc.arg(author_tenant_id), sqlc.arg(body)
)
ON CONFLICT (post_id, reply_id) DO NOTHING;

-- Applies the count rule (PST-RPL-014): the caller passes the deltas. The
-- child row count only goes up.
-- name: AdjustHubPostReplyCounts :one
WITH post AS (
    UPDATE vetchium.hub_posts AS p
    SET reply_count = p.reply_count + sqlc.arg(reply_delta)::integer
    WHERE p.post_id = sqlc.arg(post_id)
      AND sqlc.arg(reply_delta)::integer <> 0
    RETURNING p.post_id
), parent AS (
    UPDATE vetchium.hub_post_replies AS r
    SET child_count = r.child_count + sqlc.arg(child_delta)::integer,
        child_row_count = r.child_row_count
            + GREATEST(sqlc.arg(child_row_delta)::integer, 0)
    WHERE r.post_id = sqlc.arg(post_id)
      AND r.reply_id = sqlc.narg(parent_reply_id)::text
    RETURNING r.reply_id
)
SELECT (SELECT count(*) FROM post)::bigint AS post_rows,
    (SELECT count(*) FROM parent)::bigint AS parent_rows;

-- The owner hides or unhides a reply (PST-RPL-012). It returns the old and the
-- new state so the caller applies the count rule. A repeat writes no row, so
-- the transaction needs no audit event. Zero rows means the reply is missing
-- or not live or hidden.
-- name: SetHubPostReplyState :one
WITH target AS (
    SELECT r.post_id, r.reply_id, r.state AS old_state, r.parent_reply_id
    FROM vetchium.hub_post_replies AS r
    WHERE r.post_id = sqlc.arg(post_id)
      AND r.reply_id = sqlc.arg(reply_id)
      AND r.state IN ('live', 'hidden_by_owner')
    FOR UPDATE
),
changed AS (
    UPDATE vetchium.hub_post_replies AS r
    SET state = sqlc.arg(new_state)::vetchium.hub_post_reply_state
    FROM target
    WHERE r.post_id = target.post_id
      AND r.reply_id = target.reply_id
      AND r.state <> sqlc.arg(new_state)::vetchium.hub_post_reply_state
      AND sqlc.arg(new_state)::vetchium.hub_post_reply_state
          IN ('live', 'hidden_by_owner')
)
SELECT target.old_state,
    sqlc.arg(new_state)::vetchium.hub_post_reply_state AS new_state,
    target.parent_reply_id
FROM target
WHERE sqlc.arg(new_state)::vetchium.hub_post_reply_state
      IN ('live', 'hidden_by_owner');

-- The reply author edited the reply (PST-RPL-010). A removed copy stays
-- removed.
-- name: UpdateHubPostReplyCopy :execrows
UPDATE vetchium.hub_post_replies AS r
SET body = sqlc.arg(body), revision = sqlc.arg(revision)::integer
WHERE r.post_id = sqlc.arg(post_id)
  AND r.reply_id = sqlc.arg(reply_id)
  AND r.state IN ('live', 'hidden_by_owner')
  AND r.revision < sqlc.arg(revision)::integer;

-- The reply author removed the reply (PST-OWN-002). It returns the old state
-- for the count rule; zero rows means the copy is already cleared or missing.
-- name: ClearHubPostReplyCopy :one
WITH target AS (
    SELECT r.post_id, r.reply_id, r.state AS old_state
    FROM vetchium.hub_post_replies AS r
    WHERE r.post_id = sqlc.arg(post_id)
      AND r.reply_id = sqlc.arg(reply_id)
      AND r.state <> 'author_removed'
    FOR UPDATE
)
UPDATE vetchium.hub_post_replies AS r
SET state = 'author_removed', body = NULL
FROM target
WHERE r.post_id = target.post_id
  AND r.reply_id = target.reply_id
RETURNING target.old_state, r.parent_reply_id;

-- One page of a thread (PST-THR-002): top-level replies when parent_reply_id
-- is NULL, else the sub-replies of that reply. The page starts after the
-- `after` position, or at the `from` position (PST-THR-009). The caller asks
-- for one row more than the page size.
-- name: ListHubPostReplies :many
SELECT r.reply_id, r.parent_reply_id, r.author_hub_user_did, r.author_handle,
    r.author_tenant_id, r.body, r.revision, r.state, r.child_count,
    r.child_row_count, r.created_at
FROM vetchium.hub_post_replies AS r
WHERE r.post_id = sqlc.arg(post_id)
  AND (
        (sqlc.narg(parent_reply_id)::text IS NULL AND r.parent_reply_id IS NULL)
        OR r.parent_reply_id = sqlc.narg(parent_reply_id)::text
    )
  AND (
        sqlc.narg(after_created_at)::timestamptz IS NULL
        OR (r.created_at, r.reply_id) > (
            sqlc.narg(after_created_at)::timestamptz,
            sqlc.narg(after_reply_id)::text COLLATE "C"
        )
    )
  AND (
        sqlc.narg(from_created_at)::timestamptz IS NULL
        OR (r.created_at, r.reply_id) >= (
            sqlc.narg(from_created_at)::timestamptz,
            sqlc.narg(from_reply_id)::text COLLATE "C"
        )
    )
ORDER BY r.created_at ASC, r.reply_id ASC
LIMIT sqlc.arg(page_limit);

-- name: GetHubPostReply :one
SELECT r.reply_id, r.parent_reply_id, r.author_hub_user_did, r.author_handle,
    r.author_tenant_id, r.body, r.revision, r.state, r.child_count,
    r.child_row_count, r.created_at
FROM vetchium.hub_post_replies AS r
WHERE r.post_id = sqlc.arg(post_id)
  AND r.reply_id = sqlc.arg(reply_id);

-- ---------------------------------------------------------------------------
-- Post cleanup (PST-RPL-013)
-- ---------------------------------------------------------------------------

-- name: ListRemovedHubPostsForCleanup :many
SELECT p.post_id, p.author_hub_user_did, p.version, p.cleanup_author_cursor
FROM vetchium.hub_posts AS p
WHERE p.state <> 'live'
  AND p.cleanup_done_at IS NULL
ORDER BY p.removed_at NULLS LAST, p.post_id
LIMIT sqlc.arg(page_limit);

-- Locks the post for one cleanup commit, so two workers never enqueue the same
-- page.
-- name: GetHubPostForCleanup :one
SELECT p.post_id, p.author_hub_user_did, p.state, p.version,
    p.cleanup_author_cursor, p.cleanup_done_at
FROM vetchium.hub_posts AS p
WHERE p.post_id = sqlc.arg(post_id)
FOR UPDATE;

-- One page of distinct reply authors, ordered by DID. Authors whose replies
-- are all author_removed hold no words to mark and are left out.
-- name: ListHubPostReplyAuthors :many
SELECT DISTINCT ON (r.author_hub_user_did)
    r.author_hub_user_did, r.author_handle, r.author_tenant_id
FROM vetchium.hub_post_replies AS r
WHERE r.post_id = sqlc.arg(post_id)
  AND r.state <> 'author_removed'
  AND (
        sqlc.narg(after_author_hub_user_did)::uuid IS NULL
        OR r.author_hub_user_did > sqlc.narg(after_author_hub_user_did)::uuid
    )
ORDER BY r.author_hub_user_did, r.created_at DESC
LIMIT sqlc.arg(page_limit);

-- Records the last reply author a cleanup commit enqueued for, so a later run
-- resumes after it.
-- name: SetHubPostCleanupCursor :execrows
UPDATE vetchium.hub_posts AS p
SET cleanup_author_cursor = sqlc.arg(cleanup_author_cursor)
WHERE p.post_id = sqlc.arg(post_id)
  AND p.state <> 'live'
  AND p.cleanup_done_at IS NULL;

-- Deletes one batch of the post's structure rows that have no sub-reply row,
-- so a commit stays bounded and a parent goes after its children.
-- name: DeleteHubPostReplyLeaves :execrows
WITH doomed AS (
    SELECT r.post_id, r.reply_id
    FROM vetchium.hub_post_replies AS r
    WHERE r.post_id = sqlc.arg(post_id)
      AND NOT EXISTS (
          SELECT 1
          FROM vetchium.hub_post_replies AS child
          WHERE child.post_id = r.post_id
            AND child.parent_reply_id = r.reply_id
      )
    ORDER BY r.reply_id
    LIMIT sqlc.arg(batch)::int
    FOR UPDATE
)
DELETE FROM vetchium.hub_post_replies AS r
USING doomed
WHERE r.post_id = doomed.post_id
  AND r.reply_id = doomed.reply_id;

-- name: MarkHubPostCleanupDone :execrows
UPDATE vetchium.hub_posts AS p
SET cleanup_done_at = now()
WHERE p.post_id = sqlc.arg(post_id)
  AND p.state <> 'live'
  AND p.cleanup_done_at IS NULL;
