-- Hub quote posts (agent-guides/posts.md, Quotes). The quoter's tenant holds
-- the quote post and its words (hub_posts); the target owner's tenant holds one
-- hub_post_quotes row for each quote of a timeline post. A query that always
-- runs beside an audited statement carries no audit CTE; the caller writes the
-- event. The audit never holds words.

-- ---------------------------------------------------------------------------
-- Quoter side
-- ---------------------------------------------------------------------------

-- Creates a quote post (PST-QTE-001, PST-QTE-004). Every tier quotes, so the
-- statement has no plan gate. The caller locks the user (LockHubUserForPosting)
-- and counts first. Zero inserted rows means the user is not active.
-- name: InsertHubQuotePost :one
WITH inserted AS (
    INSERT INTO vetchium.hub_posts (
        post_id, author_hub_user_did, kind, body, reply_policy, quote_policy,
        quote_target_type, quote_owner_principal_type, quote_owner_did,
        quote_owner_address, quote_owner_tenant_id, quote_target_id
    )
    SELECT sqlc.arg(post_id), u.hub_user_did, 'quote', sqlc.arg(body),
        sqlc.arg(reply_policy), sqlc.arg(quote_policy),
        sqlc.arg(quote_target_type), sqlc.arg(quote_owner_principal_type)::text,
        sqlc.arg(quote_owner_did), sqlc.arg(quote_owner_address)::text,
        sqlc.arg(quote_owner_tenant_id)::text, sqlc.arg(quote_target_id)::text
    FROM vetchium.hub_users AS u
    WHERE u.hub_user_did = sqlc.arg(author_hub_user_did)
      AND u.hub_user_state = 'active'
    RETURNING post_id, author_hub_user_did, kind, version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.post.quoted', 'hub_post',
        inserted.post_id, 'hub_user', inserted.author_hub_user_did::text,
        inserted.author_hub_user_did, 'hub-api',
        sqlc.narg(idempotency_key)::text,
        jsonb_build_object('schema_version', 1, 'kind', inserted.kind)
    FROM inserted
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM inserted)::bigint AS inserted_rows,
    (SELECT count(*) FROM audit)::bigint AS audit_rows,
    COALESCE((SELECT max(inserted.version) FROM inserted), 0)::bigint
        AS version;

-- Locks a live post of the author and returns its quote target, so removal
-- can tell the target owner (PST-QTE-006). No row means the post is not the
-- author's or not live.
-- name: GetHubPostQuoteRefForRemoval :one
SELECT p.kind, p.quote_target_type, p.quote_owner_did, p.quote_target_id
FROM vetchium.hub_posts AS p
WHERE p.post_id = sqlc.arg(post_id)
  AND p.author_hub_user_did = sqlc.arg(author_hub_user_did)
  AND p.state = 'live'
FOR UPDATE;

-- ---------------------------------------------------------------------------
-- Target owner side
-- ---------------------------------------------------------------------------

-- The state, the policy, and the author of a target post (PST-QTE-003).
-- name: GetHubPostForQuote :one
SELECT p.post_id, p.author_hub_user_did, p.state, p.quote_policy,
    p.quote_count
FROM vetchium.hub_posts AS p
WHERE p.post_id = sqlc.arg(post_id);

-- Locks a target post for a quote event (PST-QTE-005, PST-QTE-006). The
-- receivers lock the post before the quote row, as a detach does, so the two
-- never deadlock.
-- name: LockHubPostForQuote :one
SELECT p.post_id, p.author_hub_user_did, p.state, p.quote_policy,
    p.quote_count
FROM vetchium.hub_posts AS p
WHERE p.post_id = sqlc.arg(post_id)
FOR UPDATE;

-- The quote rows of quote posts, for embed reads (PST-QTE-009).
-- name: GetHubPostQuotesByQuoteIDs :many
SELECT q.target_post_id, q.quoter_hub_user_did, q.quote_post_id,
    q.detached_at
FROM vetchium.hub_post_quotes AS q
WHERE q.quote_post_id = ANY(sqlc.arg(quote_post_ids)::text[]);

-- A redelivered event inserts nothing; zero rows tells the caller to skip the
-- count change. A set detached flag stores the row as detached (PST-QTE-005).
-- name: InsertHubPostQuote :execrows
INSERT INTO vetchium.hub_post_quotes (
    target_post_id, quoter_hub_user_did, quoter_handle, quoter_tenant_id,
    quote_post_id, detached_at
)
VALUES (
    sqlc.arg(target_post_id), sqlc.arg(quoter_hub_user_did),
    sqlc.arg(quoter_handle), sqlc.arg(quoter_tenant_id),
    sqlc.arg(quote_post_id),
    CASE WHEN sqlc.arg(detached)::boolean THEN now() END
)
ON CONFLICT (target_post_id, quote_post_id) DO NOTHING;

-- name: IncrementHubPostQuoteCount :execrows
UPDATE vetchium.hub_posts AS p
SET quote_count = p.quote_count + 1
WHERE p.post_id = sqlc.arg(post_id);

-- The receiver of hub-post-unquoted (PST-QTE-006). It returns the old
-- detached_at so the caller reduces the count only for an attached quote. No
-- row means the quote was never recorded.
-- name: DeleteHubPostQuote :one
DELETE FROM vetchium.hub_post_quotes AS q
WHERE q.target_post_id = sqlc.arg(target_post_id)
  AND q.quote_post_id = sqlc.arg(quote_post_id)
RETURNING q.detached_at;

-- name: DecrementHubPostQuoteCount :execrows
UPDATE vetchium.hub_posts AS p
SET quote_count = GREATEST(p.quote_count - 1, 0)
WHERE p.post_id = sqlc.arg(post_id);

-- The owner detaches one quote (PST-QTE-008). Zero rows means the quote is
-- missing or already detached; the caller then reduces no count.
-- name: DetachHubPostQuote :execrows
UPDATE vetchium.hub_post_quotes AS q
SET detached_at = now()
WHERE q.target_post_id = sqlc.arg(target_post_id)
  AND q.quote_post_id = sqlc.arg(quote_post_id)
  AND q.detached_at IS NULL;

-- name: GetHubPostQuote :one
SELECT q.target_post_id, q.quoter_hub_user_did, q.quoter_handle,
    q.quoter_tenant_id, q.quote_post_id, q.created_at, q.detached_at
FROM vetchium.hub_post_quotes AS q
WHERE q.target_post_id = sqlc.arg(target_post_id)
  AND q.quote_post_id = sqlc.arg(quote_post_id);

-- One page of the quote list (PST-QTE-012). Detached rows stay out. The
-- caller asks for one row more than the page size.
-- name: ListHubPostQuotes :many
SELECT q.quoter_hub_user_did, q.quoter_handle, q.quoter_tenant_id,
    q.quote_post_id, q.created_at
FROM vetchium.hub_post_quotes AS q
WHERE q.target_post_id = sqlc.arg(target_post_id)
  AND q.detached_at IS NULL
  AND (
        sqlc.narg(before_created_at)::timestamptz IS NULL
        OR (q.created_at, q.quote_post_id) < (
            sqlc.narg(before_created_at)::timestamptz,
            sqlc.narg(before_quote_post_id)::text COLLATE "C"
        )
    )
ORDER BY q.created_at DESC, q.quote_post_id DESC
LIMIT sqlc.arg(page_limit);

-- Deletes one batch of a removed post's quote rows (PST-RPL-013).
-- name: DeleteHubPostQuotesPage :execrows
WITH doomed AS (
    SELECT q.target_post_id, q.quote_post_id
    FROM vetchium.hub_post_quotes AS q
    WHERE q.target_post_id = sqlc.arg(target_post_id)
    ORDER BY q.quote_post_id
    LIMIT sqlc.arg(batch)::int
    FOR UPDATE
)
DELETE FROM vetchium.hub_post_quotes AS q
USING doomed
WHERE q.target_post_id = doomed.target_post_id
  AND q.quote_post_id = doomed.quote_post_id;
