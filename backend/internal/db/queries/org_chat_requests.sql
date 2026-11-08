-- Chat requests (agent-guides/marketplace.md, Chat requests). The agency's
-- tenant is authoritative; callers hold the Contact lock (LockOrgContact)
-- before reading or answering a Contact's requests. Audit events name a
-- request by the Hub user's handle and its request number.

-- name: CountOrgChatRequestsCreatedOn :one
SELECT COALESCE((
    SELECT c.created
    FROM vetchium.org_chat_request_creations AS c
    WHERE c.org_did = sqlc.arg(org_did) AND c.created_on = sqlc.arg(day)::date
), 0)::integer AS created;

-- Creates a request under the Contact's next request number and counts it
-- as the Contact's activity (MKT-REQ-012). An agency's request counts toward
-- its day's limit (MKT-REQ-006); a Hub user's was counted in their tenant.
-- The caller holds the Contact lock (and the Org lock for an agency's
-- request, whose count it checked) and has applied MKT-REQ-003.
-- name: CreateOrgChatRequest :one
WITH contact AS (
    UPDATE vetchium.org_contacts AS t
    SET last_request_number = t.last_request_number + 1,
        last_activity_at = GREATEST(t.last_activity_at, now())
    WHERE t.org_did = sqlc.arg(org_did)
      AND t.hub_user_did = sqlc.arg(hub_user_did)
    RETURNING t.org_did, t.hub_user_did, t.handle, t.last_request_number
), created AS (
    INSERT INTO vetchium.org_chat_requests (
        org_did, hub_user_did, request_number, direction, state,
        consumer_domain, opening_number, note, sender_user_id,
        sender_display_name, window_seconds
    )
    SELECT contact.org_did, contact.hub_user_did, contact.last_request_number,
        sqlc.arg(direction)::text, 'pending', sqlc.arg(consumer_domain)::text,
        sqlc.arg(opening_number)::integer, sqlc.narg(note)::text,
        sqlc.narg(sender_user_id)::uuid, sqlc.arg(sender_display_name)::text,
        sqlc.narg(window_seconds)::bigint
    FROM contact
    RETURNING org_did, hub_user_did, request_number, direction,
        consumer_domain, opening_number, sent_at
), counted AS (
    INSERT INTO vetchium.org_chat_request_creations (org_did, created_on, created)
    SELECT created.org_did, sqlc.arg(day)::date, 1
    FROM created
    WHERE created.direction = 'to_hub_user'
    ON CONFLICT (org_did, created_on) DO UPDATE
    SET created = vetchium.org_chat_request_creations.created + 1
    RETURNING created
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.chat_request.sent', 'org_chat_request',
        contact.handle, sqlc.arg(actor_type)::text,
        sqlc.arg(actor_id)::text, created.hub_user_did, created.org_did,
        sqlc.arg(source)::text, sqlc.narg(idempotency_key),
        jsonb_build_object('request_number', created.request_number,
            'direction', created.direction,
            'consumer_domain', created.consumer_domain,
            'opening_number', created.opening_number)
    FROM created, contact
    RETURNING audit_event_id
)
SELECT created.request_number, created.sent_at,
    (SELECT count(*) FROM counted) AS counted_rows,
    (SELECT count(*) FROM audit) AS audit_rows
FROM created;

-- The pending request between the pair, in either direction; the pending
-- index allows at most one (MKT-REQ-003).
-- name: GetPendingOrgChatRequest :one
SELECT sqlc.embed(r), c.display_name AS hub_user_name,
    c.handle AS hub_user_handle
FROM vetchium.org_chat_requests AS r
JOIN vetchium.org_contacts AS c
    ON c.org_did = r.org_did AND c.hub_user_did = r.hub_user_did
WHERE r.org_did = sqlc.arg(org_did)
  AND r.hub_user_did = sqlc.arg(hub_user_did)
  AND r.state = 'pending';

-- name: GetOrgChatRequest :one
SELECT sqlc.embed(r), c.display_name AS hub_user_name,
    c.handle AS hub_user_handle
FROM vetchium.org_chat_requests AS r
JOIN vetchium.org_contacts AS c
    ON c.org_did = r.org_did AND c.hub_user_did = r.hub_user_did
WHERE r.org_did = sqlc.arg(org_did)
  AND r.hub_user_did = sqlc.arg(hub_user_did)
  AND r.request_number = sqlc.arg(request_number);

-- The pair's latest request in any state, which the Contact and the pointer
-- show (MKT-DAT-003).
-- name: GetLatestOrgChatRequest :one
SELECT sqlc.embed(r), c.display_name AS hub_user_name,
    c.handle AS hub_user_handle
FROM vetchium.org_chat_requests AS r
JOIN vetchium.org_contacts AS c
    ON c.org_did = r.org_did AND c.hub_user_did = r.hub_user_did
WHERE r.org_did = sqlc.arg(org_did)
  AND r.hub_user_did = sqlc.arg(hub_user_did)
ORDER BY r.request_number DESC
LIMIT 1;

-- One page of the agency's pending requests in one direction, oldest first.
-- A pair has one pending request, so the handle orders ties.
-- name: ListPendingOrgChatRequests :many
SELECT sqlc.embed(r), c.display_name AS hub_user_name,
    c.handle AS hub_user_handle
FROM vetchium.org_chat_requests AS r
JOIN vetchium.org_contacts AS c
    ON c.org_did = r.org_did AND c.hub_user_did = r.hub_user_did
WHERE r.org_did = sqlc.arg(org_did)
  AND r.direction = sqlc.arg(direction)
  AND r.state = 'pending'
  AND (sqlc.narg(after_sent_at)::timestamptz IS NULL
      OR (r.sent_at, c.handle) >
          (sqlc.narg(after_sent_at)::timestamptz,
           sqlc.narg(after_handle)::text))
ORDER BY r.sent_at, c.handle
LIMIT sqlc.arg(page_limit);

-- One page of the agency's answered requests in one direction, newest
-- answer first; the list follows the pending ones.
-- name: ListAnsweredOrgChatRequests :many
SELECT sqlc.embed(r), c.display_name AS hub_user_name,
    c.handle AS hub_user_handle
FROM vetchium.org_chat_requests AS r
JOIN vetchium.org_contacts AS c
    ON c.org_did = r.org_did AND c.hub_user_did = r.hub_user_did
WHERE r.org_did = sqlc.arg(org_did)
  AND r.direction = sqlc.arg(direction)
  AND r.state <> 'pending'
  AND (sqlc.narg(before_answered_at)::timestamptz IS NULL
      OR (r.answered_at, c.handle, r.request_number) <
          (sqlc.narg(before_answered_at)::timestamptz,
           sqlc.narg(before_handle)::text,
           sqlc.narg(before_request_number)::integer))
ORDER BY r.answered_at DESC, c.handle DESC, r.request_number DESC
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
      AND r.hub_user_did = sqlc.arg(hub_user_did)
      AND r.request_number = sqlc.arg(request_number)
      AND r.state = 'pending'
    RETURNING r.org_did, r.hub_user_did, r.request_number, r.direction,
        r.state, r.decline_scope, r.window_seconds, r.answered_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.chat_request.' || answered.state,
        'org_chat_request', c.handle,
        sqlc.arg(actor_type)::text, sqlc.arg(actor_id)::text,
        answered.hub_user_did, answered.org_did, sqlc.arg(source)::text,
        sqlc.narg(idempotency_key),
        jsonb_strip_nulls(jsonb_build_object(
            'request_number', answered.request_number,
            'direction', answered.direction,
            'scope', answered.decline_scope))
    FROM answered
    JOIN vetchium.org_contacts AS c
        ON c.org_did = answered.org_did
        AND c.hub_user_did = answered.hub_user_did
    RETURNING audit_event_id
)
SELECT answered.request_number, answered.state, answered.decline_scope,
    answered.window_seconds, answered.answered_at,
    (SELECT count(*) FROM audit) AS audit_rows
FROM answered;

-- Records an `opening` decline's block (MKT-REQ-007). It runs only beside
-- AnswerOrgChatRequest, whose audit event covers it; an Opening already
-- blocked keeps its row.
-- name: CreateOrgChatRequestOpeningBlock :execrows
INSERT INTO vetchium.org_chat_request_opening_blocks (
    org_did, hub_user_did, blocked_direction, consumer_domain, opening_number
)
VALUES (
    sqlc.arg(org_did), sqlc.arg(hub_user_did), sqlc.arg(blocked_direction),
    sqlc.arg(consumer_domain), sqlc.arg(opening_number)
)
ON CONFLICT DO NOTHING;

-- Records a `sender` decline's block on the Contact (MKT-REQ-007): the
-- agency's requests (to_hub_user) or the Hub user's (to_agency) stop until
-- the instant. It runs only beside AnswerOrgChatRequest; a later block
-- already stored stays.
-- name: SetOrgChatRequestSenderBlock :execrows
UPDATE vetchium.org_contacts AS c
SET agency_requests_blocked_until = CASE
        WHEN sqlc.arg(blocked_direction)::text = 'to_hub_user'
        THEN GREATEST(c.agency_requests_blocked_until,
            sqlc.arg(blocked_until)::timestamptz)
        ELSE c.agency_requests_blocked_until END,
    hub_requests_blocked_until = CASE
        WHEN sqlc.arg(blocked_direction)::text = 'to_agency'
        THEN GREATEST(c.hub_requests_blocked_until,
            sqlc.arg(blocked_until)::timestamptz)
        ELSE c.hub_requests_blocked_until END
WHERE c.org_did = sqlc.arg(org_did)
  AND c.hub_user_did = sqlc.arg(hub_user_did);

-- The block that refuses a new request in the sender's direction, if any: a
-- live `sender` block first, since it names the date it lifts, then the
-- Opening's block.
-- name: FindBlockingChatRequestBlock :one
SELECT blocks.scope, blocks.blocked_until
FROM (
    SELECT 'sender'::text AS scope,
        CASE WHEN sqlc.arg(blocked_direction)::text = 'to_hub_user'
            THEN c.agency_requests_blocked_until
            ELSE c.hub_requests_blocked_until END AS blocked_until
    FROM vetchium.org_contacts AS c
    WHERE c.org_did = sqlc.arg(org_did)
      AND c.hub_user_did = sqlc.arg(hub_user_did)
    UNION ALL
    SELECT 'opening'::text AS scope, NULL::timestamptz AS blocked_until
    FROM vetchium.org_chat_request_opening_blocks AS b
    WHERE b.org_did = sqlc.arg(org_did)
      AND b.hub_user_did = sqlc.arg(hub_user_did)
      AND b.blocked_direction = sqlc.arg(blocked_direction)::text
      AND b.consumer_domain = sqlc.arg(consumer_domain)::text
      AND b.opening_number = sqlc.arg(opening_number)::integer
) AS blocks
WHERE blocks.scope = 'opening' OR blocks.blocked_until > now()
ORDER BY (blocks.scope = 'sender') DESC
LIMIT 1;

-- Expires a bounded batch of requests pending since before the cutoff, with
-- no block (MKT-REQ-009). It locks each Contact first, as every other
-- request write does, and skips one a request is answering now; the state
-- guard drops a request answered since this statement's snapshot.
-- name: ExpirePendingChatRequests :many
WITH due AS (
    SELECT r.org_did, r.hub_user_did, r.request_number, c.handle
    FROM vetchium.org_chat_requests AS r
    JOIN vetchium.org_contacts AS c
        ON c.org_did = r.org_did AND c.hub_user_did = r.hub_user_did
    WHERE r.state = 'pending'
      AND r.sent_at <= sqlc.arg(cutoff_sent_at)::timestamptz
    ORDER BY r.sent_at, r.org_did, r.hub_user_did
    LIMIT sqlc.arg(batch_size)
    FOR UPDATE OF c SKIP LOCKED
), expired AS (
    UPDATE vetchium.org_chat_requests AS r
    SET state = 'expired', answered_at = now(), note = NULL
    FROM due
    WHERE r.org_did = due.org_did AND r.hub_user_did = due.hub_user_did
      AND r.request_number = due.request_number AND r.state = 'pending'
    RETURNING r.org_did, r.hub_user_did, r.request_number, r.direction,
        due.handle
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.chat_request.expired',
        'org_chat_request', expired.handle, 'worker',
        'expire-chat-requests', expired.hub_user_did, expired.org_did,
        'workers',
        jsonb_build_object('request_number', expired.request_number,
            'direction', expired.direction)
    FROM expired
    RETURNING audit_event_id
)
SELECT expired.org_did, expired.hub_user_did,
    (SELECT count(*) FROM audit) AS audit_rows
FROM expired;

-- Lifts a bounded batch of `sender` blocks whose instant has passed
-- (MKT-REQ-012), locking each Contact like ExpirePendingChatRequests.
-- name: LiftChatRequestSenderBlocks :many
WITH due AS (
    SELECT c.org_did, c.hub_user_did
    FROM vetchium.org_contacts AS c
    WHERE c.agency_requests_blocked_until <= now()
       OR c.hub_requests_blocked_until <= now()
    ORDER BY LEAST(c.agency_requests_blocked_until,
        c.hub_requests_blocked_until), c.org_did, c.hub_user_did
    LIMIT sqlc.arg(batch_size)
    FOR UPDATE SKIP LOCKED
), lifted AS (
    UPDATE vetchium.org_contacts AS c
    SET agency_requests_blocked_until = CASE
            WHEN c.agency_requests_blocked_until <= now() THEN NULL
            ELSE c.agency_requests_blocked_until END,
        hub_requests_blocked_until = CASE
            WHEN c.hub_requests_blocked_until <= now() THEN NULL
            ELSE c.hub_requests_blocked_until END
    FROM due
    WHERE c.org_did = due.org_did AND c.hub_user_did = due.hub_user_did
    RETURNING c.org_did, c.hub_user_did, c.handle
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.chat_request_block.lifted',
        'org_contact', lifted.handle, 'worker', 'expire-chat-requests',
        lifted.hub_user_did, lifted.org_did, 'workers',
        jsonb_build_object('action', 'lifted')
    FROM lifted
    RETURNING audit_event_id
)
SELECT lifted.org_did, lifted.hub_user_did,
    (SELECT count(*) FROM audit) AS audit_rows
FROM lifted;

-- Forgets the agency daily request counts of days no limit reads any more
-- (MKT-REQ-006).
-- name: PruneOrgChatRequestCreations :many
WITH pruned AS (
    DELETE FROM vetchium.org_chat_request_creations AS c
    WHERE (c.org_did, c.created_on) IN (
        SELECT s.org_did, s.created_on
        FROM vetchium.org_chat_request_creations AS s
        WHERE s.created_on < (now() AT TIME ZONE 'UTC')::date - 1
        ORDER BY s.created_on, s.org_did
        LIMIT sqlc.arg(batch_size)
    )
    RETURNING c.org_did, c.created_on
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.chat_request_creations.pruned',
        'org_chat_request_creations', pruned.org_did::text, 'worker',
        'expire-chat-requests', pruned.org_did, 'workers',
        jsonb_build_object('action', 'pruned', 'day', pruned.created_on)
    FROM pruned
    RETURNING audit_event_id
)
SELECT pruned.org_did, (SELECT count(*) FROM audit) AS audit_rows
FROM pruned;
