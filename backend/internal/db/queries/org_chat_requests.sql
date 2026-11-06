-- Chat requests (agent-guides/marketplace.md, Chat requests). The agency's
-- tenant is authoritative; callers hold the Contact lock (LockOrgContact)
-- before reading or answering a Contact's requests.

-- name: CountOrgChatRequestsCreatedOn :one
SELECT COALESCE((
    SELECT c.created
    FROM vetchium.org_chat_request_creations AS c
    WHERE c.org_did = sqlc.arg(org_did) AND c.created_on = sqlc.arg(day)::date
), 0)::integer AS created;

-- Creates a request and counts it as the Contact's activity (MKT-REQ-012).
-- An agency's request counts toward its day's limit (MKT-REQ-006); a Hub
-- user's was counted in their tenant. The caller holds the Contact lock (and
-- the Org lock for an agency's request, whose count it checked) and has
-- applied MKT-REQ-003.
-- name: CreateOrgChatRequest :one
WITH created AS (
    INSERT INTO vetchium.org_chat_requests (
        request_id, contact_id, org_did, hub_user_did, direction, state,
        consumer_domain, opening_number, note, sender_user_id,
        sender_display_name, window_seconds
    )
    VALUES (
        sqlc.arg(request_id), sqlc.arg(contact_id), sqlc.arg(org_did),
        sqlc.arg(hub_user_did), sqlc.arg(direction), 'pending',
        sqlc.arg(consumer_domain), sqlc.arg(opening_number), sqlc.narg(note),
        sqlc.narg(sender_user_id), sqlc.arg(sender_display_name),
        sqlc.narg(window_seconds)
    )
    RETURNING request_id, contact_id, org_did, hub_user_did, direction,
        consumer_domain, opening_number, sent_at
), counted AS (
    INSERT INTO vetchium.org_chat_request_creations (org_did, created_on, created)
    SELECT created.org_did, sqlc.arg(day)::date, 1
    FROM created
    WHERE created.direction = 'to_hub_user'
    ON CONFLICT (org_did, created_on) DO UPDATE
    SET created = vetchium.org_chat_request_creations.created + 1
    RETURNING created
), contact AS (
    UPDATE vetchium.org_contacts AS t
    SET last_activity_at = GREATEST(t.last_activity_at, created.sent_at)
    FROM created
    WHERE t.contact_id = created.contact_id
    RETURNING t.contact_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.chat_request.sent', 'org_chat_request',
        created.request_id::text, sqlc.arg(actor_type)::text,
        sqlc.arg(actor_id)::text, created.hub_user_did, created.org_did,
        sqlc.arg(source)::text, sqlc.narg(idempotency_key),
        jsonb_build_object('contact_id', created.contact_id::text,
            'direction', created.direction,
            'consumer_domain', created.consumer_domain,
            'opening_number', created.opening_number)
    FROM created
    RETURNING audit_event_id
)
SELECT created.request_id, created.sent_at,
    (SELECT count(*) FROM counted) AS counted_rows,
    (SELECT count(*) FROM contact) AS contact_rows,
    (SELECT count(*) FROM audit) AS audit_rows
FROM created;

-- The pending request between the Contact's pair, in either direction; the
-- pending index allows at most one (MKT-REQ-003).
-- name: GetPendingOrgChatRequest :one
SELECT sqlc.embed(r), c.display_name AS hub_user_name,
    c.handle AS hub_user_handle
FROM vetchium.org_chat_requests AS r
JOIN vetchium.org_contacts AS c ON c.contact_id = r.contact_id
WHERE r.contact_id = sqlc.arg(contact_id) AND r.state = 'pending';

-- name: GetOrgChatRequest :one
SELECT sqlc.embed(r), c.display_name AS hub_user_name,
    c.handle AS hub_user_handle
FROM vetchium.org_chat_requests AS r
JOIN vetchium.org_contacts AS c ON c.contact_id = r.contact_id
WHERE r.org_did = sqlc.arg(org_did) AND r.request_id = sqlc.arg(request_id);

-- The Contact's latest request in any state, which the Contact and the
-- pointer show (MKT-DAT-003).
-- name: GetLatestOrgChatRequest :one
SELECT sqlc.embed(r), c.display_name AS hub_user_name,
    c.handle AS hub_user_handle
FROM vetchium.org_chat_requests AS r
JOIN vetchium.org_contacts AS c ON c.contact_id = r.contact_id
WHERE r.contact_id = sqlc.arg(contact_id)
ORDER BY r.sent_at DESC, r.request_id DESC
LIMIT 1;

-- One page of the agency's pending requests in one direction, oldest first.
-- name: ListPendingOrgChatRequests :many
SELECT sqlc.embed(r), c.display_name AS hub_user_name,
    c.handle AS hub_user_handle
FROM vetchium.org_chat_requests AS r
JOIN vetchium.org_contacts AS c ON c.contact_id = r.contact_id
WHERE r.org_did = sqlc.arg(org_did)
  AND r.direction = sqlc.arg(direction)
  AND r.state = 'pending'
  AND (sqlc.narg(after_sent_at)::timestamptz IS NULL
      OR (r.sent_at, r.request_id) >
          (sqlc.narg(after_sent_at)::timestamptz,
           sqlc.narg(after_request_id)::uuid))
ORDER BY r.sent_at, r.request_id
LIMIT sqlc.arg(page_limit);

-- One page of the agency's answered requests in one direction, newest
-- answer first; the list follows the pending ones.
-- name: ListAnsweredOrgChatRequests :many
SELECT sqlc.embed(r), c.display_name AS hub_user_name,
    c.handle AS hub_user_handle
FROM vetchium.org_chat_requests AS r
JOIN vetchium.org_contacts AS c ON c.contact_id = r.contact_id
WHERE r.org_did = sqlc.arg(org_did)
  AND r.direction = sqlc.arg(direction)
  AND r.state <> 'pending'
  AND (sqlc.narg(before_answered_at)::timestamptz IS NULL
      OR (r.answered_at, r.request_id) <
          (sqlc.narg(before_answered_at)::timestamptz,
           sqlc.narg(before_request_id)::uuid))
ORDER BY r.answered_at DESC, r.request_id DESC
LIMIT sqlc.arg(page_limit);

-- Hub users' requests awaiting the agency's answer (MKT-UI-011).
-- name: CountPendingOrgChatRequests :one
SELECT count(*)::integer AS pending
FROM vetchium.org_chat_requests AS r
WHERE r.org_did = sqlc.arg(org_did)
  AND r.direction = 'to_agency'
  AND r.state = 'pending';

-- Answers a pending request: accepting moves the note into the request
-- message the caller appends, declining deletes it (MKT-REQ-012). The
-- caller holds the Contact lock; no row changes once it was answered.
-- name: AnswerOrgChatRequest :one
WITH answered AS (
    UPDATE vetchium.org_chat_requests AS r
    SET state = sqlc.arg(state), answered_at = now(), note = NULL,
        answered_by = sqlc.narg(answered_by),
        decline_scope = sqlc.narg(decline_scope),
        window_seconds = COALESCE(sqlc.narg(window_seconds), r.window_seconds)
    WHERE r.org_did = sqlc.arg(org_did)
      AND r.request_id = sqlc.arg(request_id)
      AND r.state = 'pending'
    RETURNING r.request_id, r.contact_id, r.org_did, r.hub_user_did,
        r.direction, r.state, r.decline_scope, r.window_seconds,
        r.answered_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.chat_request.' || answered.state,
        'org_chat_request', answered.request_id::text,
        sqlc.arg(actor_type)::text, sqlc.arg(actor_id)::text,
        answered.hub_user_did, answered.org_did, sqlc.arg(source)::text,
        sqlc.narg(idempotency_key),
        jsonb_strip_nulls(jsonb_build_object(
            'contact_id', answered.contact_id::text,
            'direction', answered.direction,
            'scope', answered.decline_scope))
    FROM answered
    RETURNING audit_event_id
)
SELECT answered.request_id, answered.state, answered.decline_scope,
    answered.window_seconds, answered.answered_at,
    (SELECT count(*) FROM audit) AS audit_rows
FROM answered;

-- Records a decline's block (MKT-REQ-007). It runs only beside
-- AnswerOrgChatRequest, whose audit event covers it; an Opening already
-- blocked keeps its row.
-- name: CreateOrgChatRequestBlock :execrows
INSERT INTO vetchium.org_chat_request_blocks (
    contact_id, blocked_direction, scope, consumer_domain, opening_number,
    blocked_until
)
VALUES (
    sqlc.arg(contact_id), sqlc.arg(blocked_direction), sqlc.arg(scope),
    sqlc.narg(consumer_domain), sqlc.narg(opening_number),
    sqlc.narg(blocked_until)
)
ON CONFLICT (contact_id, blocked_direction, consumer_domain, opening_number)
    WHERE scope = 'opening'
DO NOTHING;

-- The block that refuses a new request in the sender's direction, if any: a
-- live `sender` block first, since it names the date it lifts, then the
-- Opening's block.
-- name: FindBlockingChatRequestBlock :one
SELECT b.scope, b.blocked_until
FROM vetchium.org_chat_request_blocks AS b
WHERE b.contact_id = sqlc.arg(contact_id)
  AND b.blocked_direction = sqlc.arg(blocked_direction)
  AND (
      (b.scope = 'sender' AND b.blocked_until > now())
      OR (b.scope = 'opening'
          AND b.consumer_domain = sqlc.arg(consumer_domain)::text
          AND b.opening_number = sqlc.arg(opening_number)::integer)
  )
ORDER BY (b.scope = 'sender') DESC, b.blocked_until DESC NULLS LAST
LIMIT 1;

-- Expires a bounded batch of requests pending since before the cutoff, with
-- no block (MKT-REQ-009). It locks each Contact first, as every other
-- request write does, and skips one a request is answering now; the state
-- guard drops a request answered since this statement's snapshot.
-- name: ExpirePendingChatRequests :many
WITH due AS (
    SELECT r.request_id
    FROM vetchium.org_chat_requests AS r
    JOIN vetchium.org_contacts AS c ON c.contact_id = r.contact_id
    WHERE r.state = 'pending'
      AND r.sent_at <= sqlc.arg(cutoff_sent_at)::timestamptz
    ORDER BY r.sent_at, r.request_id
    LIMIT sqlc.arg(batch_size)
    FOR UPDATE OF c SKIP LOCKED
), expired AS (
    UPDATE vetchium.org_chat_requests AS r
    SET state = 'expired', answered_at = now(), note = NULL
    FROM due
    WHERE r.request_id = due.request_id AND r.state = 'pending'
    RETURNING r.request_id, r.contact_id, r.org_did, r.hub_user_did,
        r.direction
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.chat_request.expired',
        'org_chat_request', expired.request_id::text, 'worker',
        'expire-chat-requests', expired.hub_user_did, expired.org_did,
        'workers',
        jsonb_build_object('contact_id', expired.contact_id::text,
            'direction', expired.direction)
    FROM expired
    RETURNING audit_event_id
)
SELECT expired.request_id, expired.contact_id, expired.org_did,
    expired.hub_user_did, (SELECT count(*) FROM audit) AS audit_rows
FROM expired;

-- Deletes a bounded batch of `sender` blocks that have lifted
-- (MKT-REQ-012), locking each Contact first like ExpirePendingChatRequests.
-- name: DeleteLiftedChatRequestBlocks :many
WITH due AS (
    SELECT b.block_id
    FROM vetchium.org_chat_request_blocks AS b
    JOIN vetchium.org_contacts AS c ON c.contact_id = b.contact_id
    WHERE b.blocked_until IS NOT NULL AND b.blocked_until <= now()
    ORDER BY b.blocked_until, b.block_id
    LIMIT sqlc.arg(batch_size)
    FOR UPDATE OF c SKIP LOCKED
), deleted AS (
    DELETE FROM vetchium.org_chat_request_blocks AS b
    USING due
    WHERE b.block_id = due.block_id
    RETURNING b.block_id, b.contact_id, b.blocked_direction
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.chat_request_block.lifted',
        'org_contact', deleted.contact_id::text, 'worker',
        'expire-chat-requests', c.hub_user_did, c.org_did, 'workers',
        jsonb_build_object('blocked_direction', deleted.blocked_direction)
    FROM deleted
    JOIN vetchium.org_contacts AS c ON c.contact_id = deleted.contact_id
    RETURNING audit_event_id
)
SELECT deleted.block_id, deleted.contact_id, c.org_did, c.hub_user_did,
    (SELECT count(*) FROM audit) AS audit_rows
FROM deleted
JOIN vetchium.org_contacts AS c ON c.contact_id = deleted.contact_id;
