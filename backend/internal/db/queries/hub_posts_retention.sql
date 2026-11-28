-- Retention of Hub posts (PST-RET-001). Each statement deletes at most `batch`
-- rows created before `cutoff` and returns the count.

-- Cascades to revisions, structure rows, and quote rows under each post.
-- name: PurgeHubPosts :execrows
WITH doomed AS (
    SELECT p.post_id
    FROM vetchium.hub_posts AS p
    WHERE p.created_at < sqlc.arg(cutoff)::timestamptz
    ORDER BY p.created_at, p.post_id
    LIMIT sqlc.arg(batch)::int
    FOR UPDATE SKIP LOCKED
)
DELETE FROM vetchium.hub_posts AS p
USING doomed
WHERE p.post_id = doomed.post_id;

-- Cascades to revisions.
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

-- Structure rows on younger posts. A parent stays while a child row remains,
-- so a pass removes children first and the caller repeats until no row goes.
-- name: PurgeHubPostReplies :execrows
WITH doomed AS (
    SELECT r.post_id, r.reply_id
    FROM vetchium.hub_post_replies AS r
    WHERE r.created_at < sqlc.arg(cutoff)::timestamptz
      AND NOT EXISTS (
          SELECT 1
          FROM vetchium.hub_post_replies AS child
          WHERE child.post_id = r.post_id
            AND child.parent_reply_id = r.reply_id
      )
    ORDER BY r.created_at, r.reply_id
    LIMIT sqlc.arg(batch)::int
    FOR UPDATE SKIP LOCKED
)
DELETE FROM vetchium.hub_post_replies AS r
USING doomed
WHERE r.post_id = doomed.post_id
  AND r.reply_id = doomed.reply_id;

-- Quote rows on younger posts.
-- name: PurgeHubPostQuotes :execrows
WITH doomed AS (
    SELECT q.target_post_id, q.quote_post_id
    FROM vetchium.hub_post_quotes AS q
    WHERE q.created_at < sqlc.arg(cutoff)::timestamptz
    ORDER BY q.created_at, q.quote_post_id
    LIMIT sqlc.arg(batch)::int
    FOR UPDATE SKIP LOCKED
)
DELETE FROM vetchium.hub_post_quotes AS q
USING doomed
WHERE q.target_post_id = doomed.target_post_id
  AND q.quote_post_id = doomed.quote_post_id;
