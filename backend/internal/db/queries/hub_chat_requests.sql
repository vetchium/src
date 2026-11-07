-- A Hub user's chat requests to agencies (agent-guides/marketplace.md, Chat
-- requests). The agency's tenant holds the requests; the Hub user's tenant
-- counts the sends (MKT-REQ-006).

-- name: CountHubChatRequestsCreatedOn :one
SELECT COALESCE((
    SELECT c.created
    FROM vetchium.hub_chat_request_creations AS c
    WHERE c.hub_user_did = sqlc.arg(hub_user_did)
      AND c.created_on = sqlc.arg(day)::date
), 0)::integer AS created;

-- Counts one send toward the day's limit before the command leaves, so a
-- refused request still counts. No row changes once the day holds
-- max_per_day, which the caller reports as the limit reached.
-- name: IncrementHubChatRequestCreations :one
WITH counted AS (
    INSERT INTO vetchium.hub_chat_request_creations (
        hub_user_did, created_on, created
    )
    VALUES (sqlc.arg(hub_user_did), sqlc.arg(day)::date, 1)
    ON CONFLICT (hub_user_did, created_on) DO UPDATE
    SET created = vetchium.hub_chat_request_creations.created + 1
    WHERE vetchium.hub_chat_request_creations.created
        < sqlc.arg(max_per_day)::integer
    RETURNING hub_user_did, created
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.chat-request.counted', 'hub_user',
        counted.hub_user_did::text, 'hub_user', counted.hub_user_did::text,
        counted.hub_user_did, 'hub-api',
        jsonb_build_object('day', sqlc.arg(day)::date, 'created',
            counted.created)
    FROM counted
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM counted) AS counted_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- Forgets the Hub users' daily request counts of days no limit reads any
-- more (MKT-REQ-006).
-- name: PruneHubChatRequestCreations :many
WITH pruned AS (
    DELETE FROM vetchium.hub_chat_request_creations AS c
    WHERE (c.hub_user_did, c.created_on) IN (
        SELECT s.hub_user_did, s.created_on
        FROM vetchium.hub_chat_request_creations AS s
        WHERE s.created_on < (now() AT TIME ZONE 'UTC')::date - 1
        ORDER BY s.created_on, s.hub_user_did
        LIMIT sqlc.arg(batch_size)
    )
    RETURNING c.hub_user_did, c.created_on
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.chat_request_creations.pruned',
        'hub_chat_request_creations', pruned.hub_user_did::text, 'worker',
        'expire-chat-requests', pruned.hub_user_did, 'workers',
        jsonb_build_object('action', 'pruned', 'day', pruned.created_on)
    FROM pruned
    RETURNING audit_event_id
)
SELECT pruned.hub_user_did, (SELECT count(*) FROM audit) AS audit_rows
FROM pruned;
