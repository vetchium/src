-- Retention of Hub posts (PST-RET-001). Each statement changes at most
-- `batch` rows of one table created before `cutoff` and returns them or their
-- count. A post leaves in two steps: retirement removes it, so post cleanup
-- tells its reply authors and deletes its structure and quote rows in bounded
-- commits; the purge then deletes the cleaned row.

-- The database clock, so the job and the stored timestamps use one clock.
-- name: GetHubPostRetentionCutoff :one
SELECT (now() - interval '5 years')::timestamptz AS cutoff;

-- name: PurgeHubPostRevisions :execrows
WITH doomed AS (
    SELECT v.post_id, v.revision
    FROM vetchium.hub_post_revisions AS v
    JOIN vetchium.hub_posts AS p ON p.post_id = v.post_id
    WHERE p.created_at < sqlc.arg(cutoff)::timestamptz
    ORDER BY v.post_id, v.revision
    LIMIT sqlc.arg(batch)::int
    FOR UPDATE OF v SKIP LOCKED
)
DELETE FROM vetchium.hub_post_revisions AS v
USING doomed
WHERE v.post_id = doomed.post_id
  AND v.revision = doomed.revision;

-- Removes live posts past the cutoff as the author's removal does
-- (PST-POS-007). The caller enqueues hub-post-unquoted for each quote of a
-- timeline post.
-- name: RetireHubPosts :many
WITH doomed AS (
    SELECT p.post_id
    FROM vetchium.hub_posts AS p
    WHERE p.created_at < sqlc.arg(cutoff)::timestamptz
      AND p.state = 'live'
    ORDER BY p.created_at, p.post_id
    LIMIT sqlc.arg(batch)::int
    FOR UPDATE SKIP LOCKED
)
UPDATE vetchium.hub_posts AS p
SET state = 'removed', body = NULL, removed_at = now(),
    version = p.version + 1
FROM doomed
WHERE p.post_id = doomed.post_id
RETURNING p.post_id, p.author_hub_user_did, p.version, p.quote_target_type,
    p.quote_owner_did, p.quote_target_id;

-- Deletes posts past the cutoff whose cleanup finished. Cleanup deleted their
-- structure and quote rows, so nothing cascades.
-- name: PurgeHubPosts :execrows
WITH doomed AS (
    SELECT p.post_id
    FROM vetchium.hub_posts AS p
    WHERE p.created_at < sqlc.arg(cutoff)::timestamptz
      AND p.state <> 'live'
      AND p.cleanup_done_at IS NOT NULL
    ORDER BY p.created_at, p.post_id
    LIMIT sqlc.arg(batch)::int
    FOR UPDATE SKIP LOCKED
)
DELETE FROM vetchium.hub_posts AS p
USING doomed
WHERE p.post_id = doomed.post_id;

-- name: PurgeHubReplyRevisions :execrows
WITH doomed AS (
    SELECT v.reply_id, v.revision
    FROM vetchium.hub_reply_revisions AS v
    JOIN vetchium.hub_reply_texts AS t ON t.reply_id = v.reply_id
    WHERE t.created_at < sqlc.arg(cutoff)::timestamptz
    ORDER BY v.reply_id, v.revision
    LIMIT sqlc.arg(batch)::int
    FOR UPDATE OF v SKIP LOCKED
)
DELETE FROM vetchium.hub_reply_revisions AS v
USING doomed
WHERE v.reply_id = doomed.reply_id
  AND v.revision = doomed.revision;

-- A reply is younger than its post, so the post owner's tenant retires the
-- post and clears the reply copy on the same day.
-- name: PurgeHubReplyTexts :execrows
WITH doomed AS (
    SELECT t.reply_id
    FROM vetchium.hub_reply_texts AS t
    WHERE t.created_at < sqlc.arg(cutoff)::timestamptz
    ORDER BY t.created_at, t.reply_id
    LIMIT sqlc.arg(batch)::int
    FOR UPDATE SKIP LOCKED
)
DELETE FROM vetchium.hub_reply_texts AS t
USING doomed
WHERE t.reply_id = doomed.reply_id;
