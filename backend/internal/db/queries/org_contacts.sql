-- Serializes Contact creation within an Org, so the daily count in the next
-- statement cannot race a sibling request, and a plan change, which takes the
-- same row lock (LockOrgForBilling).
-- name: LockOrgForContacts :one
SELECT o.org_did
FROM vetchium.orgs AS o
WHERE o.org_did = sqlc.arg(org_did) AND o.org_state = 'active'
FOR UPDATE;

-- An agency is an Org whose `sourcing` Listing is listed (MKT-CNV).
-- name: OrgHasListedSourcingListing :one
SELECT EXISTS (
    SELECT 1
    FROM vetchium.org_listings AS l
    WHERE l.org_did = sqlc.arg(org_did)
      AND l.capability_oid = 'sourcing'
      AND l.listing_state = 'listed'
) AS listed;

-- name: CountOrgContactsCreatedOn :one
SELECT COALESCE((
    SELECT c.created
    FROM vetchium.org_contact_creations AS c
    WHERE c.org_did = sqlc.arg(org_did) AND c.created_on = sqlc.arg(day)::date
), 0)::integer AS created;

-- Every Contact read selects these columns, from which the handler derives
-- the Contact's status (MKT-UI-007): the pending request, the window the
-- agency writes in, and the agency's latest request with its answer (state
-- '' when it sent none).
-- name: GetOrgContactByPerson :one
SELECT c.hub_user_did, c.display_name, c.handle, c.requests_off,
    c.last_activity_at,
    (SELECT count(*) FROM vetchium.org_contact_notes AS n
     WHERE n.org_did = c.org_did AND n.hub_user_did = c.hub_user_did
    )::integer AS note_count,
    (conv.org_did IS NOT NULL)::boolean AS has_conversation,
    COALESCE(conv.agency_unread_count, 0)::integer AS unread_messages_count,
    (conv.party_deleted_at IS NOT NULL)::boolean AS party_deleted,
    conv.hub_activity_at AS conversation_hub_activity_at,
    conv.window_seconds AS conversation_window_seconds,
    conv.last_activity_at AS conversation_last_activity_at,
    req.direction AS pending_request_direction,
    COALESCE(sent.state, '')::text AS latest_sent_request_state,
    sent.answered_at AS latest_sent_request_answered_at
FROM vetchium.org_contacts AS c
LEFT JOIN vetchium.org_conversations AS conv
    ON conv.org_did = c.org_did AND conv.hub_user_did = c.hub_user_did
LEFT JOIN vetchium.org_chat_requests AS req
    ON req.org_did = c.org_did AND req.hub_user_did = c.hub_user_did
    AND req.state = 'pending'
LEFT JOIN LATERAL (
    SELECT r.state, r.answered_at
    FROM vetchium.org_chat_requests AS r
    WHERE r.org_did = c.org_did AND r.hub_user_did = c.hub_user_did
      AND r.direction = 'to_hub_user'
    ORDER BY r.request_number DESC
    LIMIT 1
) AS sent ON true
WHERE c.org_did = sqlc.arg(org_did)
  AND c.hub_user_did = sqlc.arg(hub_user_did);

-- name: GetOrgContactByHandle :one
SELECT c.hub_user_did, c.display_name, c.handle, c.requests_off,
    c.last_activity_at,
    (SELECT count(*) FROM vetchium.org_contact_notes AS n
     WHERE n.org_did = c.org_did AND n.hub_user_did = c.hub_user_did
    )::integer AS note_count,
    (conv.org_did IS NOT NULL)::boolean AS has_conversation,
    COALESCE(conv.agency_unread_count, 0)::integer AS unread_messages_count,
    (conv.party_deleted_at IS NOT NULL)::boolean AS party_deleted,
    conv.hub_activity_at AS conversation_hub_activity_at,
    conv.window_seconds AS conversation_window_seconds,
    conv.last_activity_at AS conversation_last_activity_at,
    req.direction AS pending_request_direction,
    COALESCE(sent.state, '')::text AS latest_sent_request_state,
    sent.answered_at AS latest_sent_request_answered_at
FROM vetchium.org_contacts AS c
LEFT JOIN vetchium.org_conversations AS conv
    ON conv.org_did = c.org_did AND conv.hub_user_did = c.hub_user_did
LEFT JOIN vetchium.org_chat_requests AS req
    ON req.org_did = c.org_did AND req.hub_user_did = c.hub_user_did
    AND req.state = 'pending'
LEFT JOIN LATERAL (
    SELECT r.state, r.answered_at
    FROM vetchium.org_chat_requests AS r
    WHERE r.org_did = c.org_did AND r.hub_user_did = c.hub_user_did
      AND r.direction = 'to_hub_user'
    ORDER BY r.request_number DESC
    LIMIT 1
) AS sent ON true
WHERE c.org_did = sqlc.arg(org_did)
  AND c.handle = sqlc.arg(handle);

-- name: ListOrgContacts :many
SELECT c.hub_user_did, c.display_name, c.handle, c.requests_off,
    c.last_activity_at,
    (SELECT count(*) FROM vetchium.org_contact_notes AS n
     WHERE n.org_did = c.org_did AND n.hub_user_did = c.hub_user_did
    )::integer AS note_count,
    (conv.org_did IS NOT NULL)::boolean AS has_conversation,
    COALESCE(conv.agency_unread_count, 0)::integer AS unread_messages_count,
    (conv.party_deleted_at IS NOT NULL)::boolean AS party_deleted,
    conv.hub_activity_at AS conversation_hub_activity_at,
    conv.window_seconds AS conversation_window_seconds,
    conv.last_activity_at AS conversation_last_activity_at,
    req.direction AS pending_request_direction,
    COALESCE(sent.state, '')::text AS latest_sent_request_state,
    sent.answered_at AS latest_sent_request_answered_at
FROM vetchium.org_contacts AS c
LEFT JOIN vetchium.org_conversations AS conv
    ON conv.org_did = c.org_did AND conv.hub_user_did = c.hub_user_did
LEFT JOIN vetchium.org_chat_requests AS req
    ON req.org_did = c.org_did AND req.hub_user_did = c.hub_user_did
    AND req.state = 'pending'
LEFT JOIN LATERAL (
    SELECT r.state, r.answered_at
    FROM vetchium.org_chat_requests AS r
    WHERE r.org_did = c.org_did AND r.hub_user_did = c.hub_user_did
      AND r.direction = 'to_hub_user'
    ORDER BY r.request_number DESC
    LIMIT 1
) AS sent ON true
WHERE c.org_did = sqlc.arg(org_did)
  AND (
      sqlc.arg(filter)::text = 'all'
      OR (sqlc.arg(filter)::text = 'requests' AND req.org_did IS NOT NULL)
      OR (sqlc.arg(filter)::text = 'unread' AND conv.agency_unread_count > 0)
      OR (sqlc.arg(filter)::text = 'has_conversation'
          AND conv.org_did IS NOT NULL)
  )
  AND (sqlc.narg(name_query)::text IS NULL
      OR strpos(lower(c.display_name), lower(sqlc.narg(name_query)::text)) > 0)
  AND (sqlc.narg(after_activity_at)::timestamptz IS NULL
      OR (c.last_activity_at, c.handle) <
          (sqlc.narg(after_activity_at)::timestamptz,
           sqlc.narg(after_handle)::text))
ORDER BY c.last_activity_at DESC, c.handle DESC
LIMIT sqlc.arg(page_limit);

-- How many of the agency's Contacts each Contacts tab holds (MKT-UI-007).
-- name: CountOrgContactsByTab :one
SELECT count(*)::integer AS all_contacts,
    (count(req.org_did))::integer AS requests,
    (count(*) FILTER (WHERE conv.agency_unread_count > 0))::integer AS unread,
    (count(conv.org_did))::integer AS has_conversation
FROM vetchium.org_contacts AS c
LEFT JOIN vetchium.org_conversations AS conv
    ON conv.org_did = c.org_did AND conv.hub_user_did = c.hub_user_did
LEFT JOIN vetchium.org_chat_requests AS req
    ON req.org_did = c.org_did AND req.hub_user_did = c.hub_user_did
    AND req.state = 'pending'
WHERE c.org_did = sqlc.arg(org_did);

-- Serializes writes to one Contact's notes, conversation, requests, and
-- pointer, so the numbering and cap checks cannot race a sibling request.
-- name: LockOrgContact :one
SELECT c.hub_user_did, c.display_name, c.handle, c.requests_off
FROM vetchium.org_contacts AS c
WHERE c.org_did = sqlc.arg(org_did) AND c.hub_user_did = sqlc.arg(hub_user_did)
FOR UPDATE;

-- LockOrgContact for the Contact a portal names by handle.
-- name: LockOrgContactByHandle :one
SELECT c.hub_user_did, c.display_name, c.handle, c.requests_off
FROM vetchium.org_contacts AS c
WHERE c.org_did = sqlc.arg(org_did) AND c.handle = sqlc.arg(handle)
FOR UPDATE;

-- Whether the Hub account of a Contact is gone: its conversation records the
-- deletion notice (MKT-CON-004), and no note may be written on it.
-- name: OrgContactAccountDeleted :one
SELECT EXISTS (
    SELECT 1 FROM vetchium.org_conversations AS conv
    WHERE conv.org_did = sqlc.arg(org_did)
      AND conv.hub_user_did = sqlc.arg(hub_user_did)
      AND conv.read_only_reason = 'hub_user_deleted'
) AS account_deleted;

-- name: ListOrgContactNotes :many
SELECT n.note_number, n.author_id, u.email_address AS author, n.note_text,
    n.created_at, n.edited_at
FROM vetchium.org_contact_notes AS n
JOIN vetchium.org_users AS u ON u.org_user_id = n.author_id
WHERE n.org_did = sqlc.arg(org_did)
  AND n.hub_user_did = sqlc.arg(hub_user_did)
  AND (sqlc.narg(after_created_at)::timestamptz IS NULL
      OR (n.created_at, n.note_number) <
          (sqlc.narg(after_created_at)::timestamptz,
           sqlc.narg(after_note_number)::integer))
ORDER BY n.created_at DESC, n.note_number DESC
LIMIT sqlc.arg(page_limit);

-- name: GetOrgContactNoteAuthor :one
SELECT n.author_id
FROM vetchium.org_contact_notes AS n
WHERE n.org_did = sqlc.arg(org_did)
  AND n.hub_user_did = sqlc.arg(hub_user_did)
  AND n.note_number = sqlc.arg(note_number);

-- Creates the Contact and counts it toward the day's limit; the caller holds
-- the Org lock and found no Contact for the person. requests_off is from the
-- live profile read: a Contact created again for the pair would ignore a
-- requests-changed event at a version the pair's watermark already holds.
-- name: CreateOrgContact :one
WITH created AS (
    INSERT INTO vetchium.org_contacts (
        org_did, hub_user_did, display_name, handle, requests_off, created_by
    )
    VALUES (
        sqlc.arg(org_did), sqlc.arg(hub_user_did), sqlc.arg(display_name),
        sqlc.arg(handle), sqlc.arg(requests_off), sqlc.arg(actor_id)
    )
    RETURNING handle, created_at, last_activity_at
), counted AS (
    INSERT INTO vetchium.org_contact_creations (org_did, created_on, created)
    SELECT sqlc.arg(org_did), sqlc.arg(day)::date, 1
    FROM created
    ON CONFLICT (org_did, created_on) DO UPDATE
    SET created = vetchium.org_contact_creations.created + 1
    RETURNING created
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.contact.created', 'org_contact',
        created.handle, 'org_user', sqlc.arg(actor_id)::uuid::text,
        sqlc.arg(hub_user_did), sqlc.arg(org_did), 'orgs-api',
        sqlc.arg(idempotency_key), jsonb_build_object('action', 'created')
    FROM created
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM created) AS created_rows,
    (SELECT count(*) FROM counted) AS counted_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- Creates the Contact a Hub user's chat request needs. It has no creator and
-- does not count toward the agency's daily Contacts (MKT-CON-005); the
-- caller holds the Org lock and found no Contact for the person.
-- requests_off is from the request, as CreateOrgContact's is from the read.
-- name: CreateOrgContactForHubRequest :one
WITH created AS (
    INSERT INTO vetchium.org_contacts (
        org_did, hub_user_did, display_name, handle, requests_off
    )
    VALUES (
        sqlc.arg(org_did), sqlc.arg(hub_user_did), sqlc.arg(display_name),
        sqlc.arg(handle), sqlc.arg(requests_off)
    )
    RETURNING handle
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.contact.created', 'org_contact',
        created.handle, 'hub_user', sqlc.arg(hub_user_did)::uuid::text,
        sqlc.arg(hub_user_did), sqlc.arg(org_did), sqlc.arg(source)::text,
        sqlc.narg(idempotency_key),
        jsonb_build_object('action', 'created', 'by', 'chat_request')
    FROM created
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM created) AS created_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- Refreshes the name a Contact records, when it differs from the profile
-- just read (MKT-CON-001). No row changes when it matches.
-- name: RefreshOrgContactNames :one
WITH changed AS (
    UPDATE vetchium.org_contacts AS c
    SET display_name = sqlc.arg(display_name)
    WHERE c.org_did = sqlc.arg(org_did)
      AND c.hub_user_did = sqlc.arg(hub_user_did)
      AND c.display_name IS DISTINCT FROM sqlc.arg(display_name)::text
    RETURNING c.handle, c.hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.contact.refreshed', 'org_contact',
        changed.handle, 'org_user', sqlc.arg(actor_id)::uuid::text,
        changed.hub_user_did, sqlc.arg(org_did), 'orgs-api',
        sqlc.narg(idempotency_key), jsonb_build_object('action', 'refreshed')
    FROM changed
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- Records the name the Hub user wrote under (MKT-CON-001). It runs only
-- beside the command's audited statement.
-- name: RefreshOrgContactNamesFromHubUser :execrows
UPDATE vetchium.org_contacts AS c
SET display_name = sqlc.arg(display_name)
WHERE c.org_did = sqlc.arg(org_did)
  AND c.hub_user_did = sqlc.arg(hub_user_did)
  AND c.display_name IS DISTINCT FROM sqlc.arg(display_name)::text;

-- Adds a note under the Contact's next note number and counts it as the
-- Contact's activity. A Contact already at the cap gets no row (has_room is
-- false); the caller holds the Contact lock.
-- name: AddOrgContactNote :one
WITH room AS (
    SELECT count(*) < sqlc.arg(note_limit)::integer AS has_room
    FROM vetchium.org_contact_notes AS n
    WHERE n.org_did = sqlc.arg(org_did)
      AND n.hub_user_did = sqlc.arg(hub_user_did)
), numbered AS (
    UPDATE vetchium.org_contacts AS c
    SET last_note_number = c.last_note_number + 1, last_activity_at = now()
    FROM room
    WHERE c.org_did = sqlc.arg(org_did)
      AND c.hub_user_did = sqlc.arg(hub_user_did)
      AND room.has_room
    RETURNING c.handle, c.last_note_number
), inserted AS (
    INSERT INTO vetchium.org_contact_notes (
        org_did, hub_user_did, note_number, author_id, note_text
    )
    SELECT sqlc.arg(org_did), sqlc.arg(hub_user_did),
        numbered.last_note_number, sqlc.arg(actor_id), sqlc.arg(note_text)
    FROM numbered
    RETURNING note_number, created_at
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.contact.note_added', 'org_contact',
        numbered.handle, 'org_user', sqlc.arg(actor_id)::uuid::text,
        sqlc.arg(hub_user_did), sqlc.arg(org_did), 'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('action', 'note_added',
            'note_number', numbered.last_note_number)
    FROM numbered
    RETURNING audit_event_id
)
SELECT room.has_room, inserted.note_number, inserted.created_at,
    (SELECT u.email_address FROM vetchium.org_users AS u
     WHERE u.org_user_id = sqlc.arg(actor_id)) AS author,
    (SELECT count(*) FROM audit) AS audit_rows
FROM room
LEFT JOIN inserted ON true;

-- Replaces the text of the author's note. No row changes for anyone else.
-- name: EditOrgContactNote :one
WITH edited AS (
    UPDATE vetchium.org_contact_notes AS n
    SET note_text = sqlc.arg(note_text), edited_at = now()
    WHERE n.org_did = sqlc.arg(org_did)
      AND n.hub_user_did = sqlc.arg(hub_user_did)
      AND n.note_number = sqlc.arg(note_number)
      AND n.author_id = sqlc.arg(actor_id)
    RETURNING n.note_number, n.created_at, n.edited_at
), touched AS (
    UPDATE vetchium.org_contacts AS c
    SET last_activity_at = now()
    WHERE c.org_did = sqlc.arg(org_did)
      AND c.hub_user_did = sqlc.arg(hub_user_did)
      AND EXISTS (SELECT 1 FROM edited)
    RETURNING c.handle, c.hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.contact.note_edited', 'org_contact',
        touched.handle, 'org_user', sqlc.arg(actor_id)::uuid::text,
        touched.hub_user_did, sqlc.arg(org_did), 'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('action', 'note_edited',
            'note_number', sqlc.arg(note_number)::integer)
    FROM touched
    RETURNING audit_event_id
)
SELECT edited.note_number, edited.created_at, edited.edited_at,
    (SELECT u.email_address FROM vetchium.org_users AS u
     WHERE u.org_user_id = sqlc.arg(actor_id)) AS author,
    (SELECT count(*) FROM audit) AS audit_rows
FROM edited;

-- Deletes a Contact with neither notes nor a conversation, in the
-- transaction that removed the last of them (MKT-CON-004). A pending chat
-- request or a block keeps it (MKT-REQ-012). No row is returned while any
-- of them remains.
-- name: DeleteUnusedOrgContact :one
WITH deleted AS (
    DELETE FROM vetchium.org_contacts AS c
    WHERE c.org_did = sqlc.arg(org_did)
      AND c.hub_user_did = sqlc.arg(hub_user_did)
      AND c.agency_requests_blocked_until IS NULL
      AND c.hub_requests_blocked_until IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_contact_notes AS n
          WHERE n.org_did = c.org_did AND n.hub_user_did = c.hub_user_did
      )
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_conversations AS conv
          WHERE conv.org_did = c.org_did AND conv.hub_user_did = c.hub_user_did
      )
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_chat_requests AS r
          WHERE r.org_did = c.org_did AND r.hub_user_did = c.hub_user_did
            AND r.state = 'pending'
      )
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_chat_request_opening_blocks AS b
          WHERE b.org_did = c.org_did AND b.hub_user_did = c.hub_user_did
      )
    RETURNING c.handle, c.hub_user_did, c.pointer_version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.contact.deleted', 'org_contact',
        deleted.handle, sqlc.arg(actor_type)::text,
        sqlc.arg(actor_id)::text, deleted.hub_user_did, sqlc.arg(org_did),
        sqlc.arg(source)::text, sqlc.narg(idempotency_key),
        jsonb_build_object('reason', 'unused')
    FROM deleted
    RETURNING audit_event_id
)
SELECT deleted.hub_user_did, deleted.pointer_version,
    (SELECT count(*) FROM audit) AS audit_rows
FROM deleted;

-- Contacts whose last note write, message, or chat request is older than
-- the retention period and that hold no conversation, pending request, or
-- block (MKT-CON-004, MKT-REQ-012). The worker re-checks the guard in
-- RetainOrgContact, so a stale list only costs a no-op.
-- name: ListOrgContactsDueForRetention :many
SELECT c.org_did, c.hub_user_did
FROM vetchium.org_contacts AS c
WHERE c.last_activity_at <= now() - interval '730 days'
  AND c.agency_requests_blocked_until IS NULL
  AND c.hub_requests_blocked_until IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM vetchium.org_chat_requests AS r
      WHERE r.org_did = c.org_did AND r.hub_user_did = c.hub_user_did
        AND r.state = 'pending'
  )
  AND NOT EXISTS (
      SELECT 1 FROM vetchium.org_chat_request_opening_blocks AS b
      WHERE b.org_did = c.org_did AND b.hub_user_did = c.hub_user_did
  )
  AND NOT EXISTS (
      SELECT 1 FROM vetchium.org_conversations AS conv
      WHERE conv.org_did = c.org_did AND conv.hub_user_did = c.hub_user_did
  )
ORDER BY c.last_activity_at, c.org_did, c.hub_user_did
LIMIT sqlc.arg(batch_size);

-- Deletes one Contact with its notes once its retention period has passed.
-- name: RetainOrgContact :one
WITH deleted AS (
    DELETE FROM vetchium.org_contacts AS c
    WHERE c.org_did = sqlc.arg(org_did)
      AND c.hub_user_did = sqlc.arg(hub_user_did)
      AND c.last_activity_at <= now() - interval '730 days'
      AND c.agency_requests_blocked_until IS NULL
      AND c.hub_requests_blocked_until IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_chat_requests AS r
          WHERE r.org_did = c.org_did AND r.hub_user_did = c.hub_user_did
            AND r.state = 'pending'
      )
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_chat_request_opening_blocks AS b
          WHERE b.org_did = c.org_did AND b.hub_user_did = c.hub_user_did
      )
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_conversations AS conv
          WHERE conv.org_did = c.org_did AND conv.hub_user_did = c.hub_user_did
      )
    RETURNING c.handle, c.org_did, c.hub_user_did, c.pointer_version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.contact.deleted', 'org_contact',
        deleted.handle, 'worker', 'retain-org-contacts',
        deleted.hub_user_did, deleted.org_did, 'workers',
        jsonb_build_object('action', 'deleted', 'reason', 'retention')
    FROM deleted
    RETURNING audit_event_id
)
SELECT deleted.org_did, deleted.hub_user_did, deleted.pointer_version,
    (SELECT count(*) FROM audit) AS audit_rows
FROM deleted;

-- Forgets the daily counts of days no limit reads any more.
-- name: PruneOrgContactCreations :many
WITH pruned AS (
    DELETE FROM vetchium.org_contact_creations AS c
    WHERE (c.org_did, c.created_on) IN (
        SELECT s.org_did, s.created_on
        FROM vetchium.org_contact_creations AS s
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
    SELECT sqlc.arg(tenant_id), 'org.contact_creations.pruned',
        'org_contact_creations', pruned.org_did::text, 'worker',
        'retain-org-contacts', pruned.org_did, 'workers',
        jsonb_build_object('action', 'pruned', 'day', pruned.created_on)
    FROM pruned
    RETURNING audit_event_id
)
SELECT pruned.org_did, (SELECT count(*) FROM audit) AS audit_rows
FROM pruned;

-- Applies hub-agency-requests-changed at the agency's tenant. The receiver
-- calls it only for an event newer than its watermark, so it overwrites; the
-- receipt's audit event covers the write.
-- name: SetOrgContactRequestsOff :execrows
UPDATE vetchium.org_contacts AS c
SET requests_off = sqlc.arg(requests_off)
WHERE c.org_did = sqlc.arg(org_did)
  AND c.hub_user_did = sqlc.arg(hub_user_did);

-- Takes the Contact's next pointer version and reads what the pointer
-- carries (MKT-DAT-003): the conversation's recorded agency name and domain,
-- last activity, read-only reason, and window, while one exists. Every
-- pointer event carries a new version, so the Hub user's tenant applies each
-- one.
-- name: NextOrgContactPointer :one
WITH bumped AS (
    UPDATE vetchium.org_contacts AS c
    SET pointer_version = c.pointer_version + 1
    WHERE c.org_did = sqlc.arg(org_did)
      AND c.hub_user_did = sqlc.arg(hub_user_did)
    RETURNING c.org_did, c.hub_user_did, c.pointer_version
)
SELECT bumped.org_did, bumped.hub_user_did, bumped.pointer_version,
    (conv.org_did IS NOT NULL)::boolean AS has_conversation,
    conv.recorded_agency_name, conv.recorded_agency_domain,
    conv.last_activity_at, conv.read_only_reason, conv.hub_activity_at,
    conv.agency_activity_at, conv.window_seconds
FROM bumped
LEFT JOIN vetchium.org_conversations AS conv
    ON conv.org_did = bumped.org_did AND conv.hub_user_did = bumped.hub_user_did;

-- Applies hub-account-deleted at the agency's tenant: the notes on the
-- person go at once (MKT-DAT-012); the receipt's audit event covers it.
-- name: DeleteOrgContactNotesOfPerson :execrows
DELETE FROM vetchium.org_contact_notes AS n
WHERE n.org_did = sqlc.arg(org_did)
  AND n.hub_user_did = sqlc.arg(hub_user_did);

-- Then the person's Contact goes, unless its conversation remains
-- (MKT-CON-004); MarkOrgConversationsHubUserDeleted made that read-only.
-- name: DeleteOrgContactsWithoutConversationOfPerson :execrows
DELETE FROM vetchium.org_contacts AS c
WHERE c.org_did = sqlc.arg(org_did)
  AND c.hub_user_did = sqlc.arg(hub_user_did)
  AND NOT EXISTS (
      SELECT 1 FROM vetchium.org_conversations AS conv
      WHERE conv.org_did = c.org_did AND conv.hub_user_did = c.hub_user_did
  );

-- The Hub user's side of agency Contacts: the requests setting and its
-- version, for an account that can be reached.
-- name: GetHubUserAgencyState :one
SELECT u.agencies_may_message, u.agencies_may_message_version
FROM vetchium.hub_users AS u
WHERE u.hub_user_did = sqlc.arg(hub_user_did)
  AND u.hub_user_state = 'active';

-- name: UpsertHubAgencyPointer :execrows
INSERT INTO vetchium.hub_agency_pointers (
    hub_user_did, agency_org_did, agency_display_name, agency_domain,
    has_conversation, has_request, request, agency_may_write_until,
    hub_may_write_until, last_activity_at, unread_count,
    read_only_reason, suggestions, pointer_version
)
VALUES (
    sqlc.arg(hub_user_did), sqlc.arg(agency_org_did),
    sqlc.arg(agency_display_name), sqlc.arg(agency_domain),
    sqlc.arg(has_conversation), sqlc.narg(request)::jsonb IS NOT NULL,
    sqlc.narg(request)::jsonb, sqlc.narg(agency_may_write_until),
    sqlc.narg(hub_may_write_until), sqlc.arg(last_activity_at),
    sqlc.arg(unread_count), sqlc.narg(read_only_reason), sqlc.arg(suggestions),
    sqlc.arg(pointer_version)
)
ON CONFLICT (hub_user_did, agency_org_did) DO UPDATE
SET agency_display_name = EXCLUDED.agency_display_name,
    agency_domain = EXCLUDED.agency_domain,
    has_conversation = EXCLUDED.has_conversation,
    has_request = EXCLUDED.has_request,
    request = EXCLUDED.request,
    agency_may_write_until = EXCLUDED.agency_may_write_until,
    hub_may_write_until = EXCLUDED.hub_may_write_until,
    last_activity_at = EXCLUDED.last_activity_at,
    unread_count = CASE WHEN sqlc.arg(increment_unread)::boolean THEN vetchium.hub_agency_pointers.unread_count + 1 ELSE EXCLUDED.unread_count END,
    read_only_reason = EXCLUDED.read_only_reason,
    suggestions = EXCLUDED.suggestions,
    pointer_version = EXCLUDED.pointer_version
WHERE vetchium.hub_agency_pointers.pointer_version <= EXCLUDED.pointer_version;

-- name: MarkHubAgencyPointerRead :one
WITH updated AS (
    UPDATE vetchium.hub_agency_pointers
    SET unread_count = 0
    WHERE hub_user_did = sqlc.arg(hub_user_did)
      AND agency_org_did = sqlc.arg(agency_org_did)
      AND unread_count > 0
    RETURNING hub_user_did, agency_domain
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.agency-conversation.marked-read',
        'hub_agency_pointer', updated.agency_domain, 'hub_user',
        updated.hub_user_did::text, updated.hub_user_did, 'hub-api',
        jsonb_build_object('agency_domain', updated.agency_domain)
    FROM updated
    RETURNING audit_event_id
)
SELECT count(*)::bigint FROM updated;

-- Records the deletion of a message in an agency conversation on the Hub
-- user's side (MKT-CNV-007). The text is recorded only when the message was
-- the Hub user's own, read live just before the delete command left.
-- name: AuditHubAgencyMessageDeleted :one
WITH audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, idempotency_key, payload
    )
    VALUES (
        sqlc.arg(tenant_id), 'hub.agency-conversation.message-deleted',
        'hub_agency_pointer', sqlc.arg(agency_domain)::text,
        sqlc.arg(actor_type)::text, sqlc.arg(actor_id)::text,
        sqlc.arg(hub_user_did), sqlc.arg(source)::text,
        sqlc.narg(idempotency_key),
        jsonb_strip_nulls(jsonb_build_object(
            'agency_domain', sqlc.arg(agency_domain)::text,
            'message_number', sqlc.arg(message_number)::integer,
            'deleted_by', sqlc.arg(deleted_by)::text,
            'deleted_text', sqlc.narg(deleted_text)::text))
    )
    RETURNING audit_event_id
)
SELECT count(*)::bigint FROM audit;

-- Records the Hub user's answer, as the agency confirmed it, on the pointer
-- before the agency's pointer event arrives, so the next read and reply agree
-- with it. The version stays, so that event still replaces the row.
-- name: SetHubAgencyPointerAnsweredRequest :one
WITH updated AS (
    UPDATE vetchium.hub_agency_pointers
    SET request = sqlc.arg(request)::jsonb,
        has_conversation = has_conversation OR sqlc.arg(accepted)::boolean
    WHERE hub_user_did = sqlc.arg(hub_user_did)
      AND agency_org_did = sqlc.arg(agency_org_did)
      AND has_request
      AND request ->> 'request_number'
          = sqlc.arg(request)::jsonb ->> 'request_number'
      AND request ->> 'state' = 'pending'
    RETURNING hub_user_did, agency_domain
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.agency-chat-request.answered',
        'hub_agency_pointer', updated.agency_domain, 'hub_user',
        updated.hub_user_did::text, updated.hub_user_did, 'hub-api',
        jsonb_build_object(
            'agency_domain', updated.agency_domain,
            'request_number',
                (sqlc.arg(request)::jsonb ->> 'request_number')::integer,
            'state', sqlc.arg(request)::jsonb ->> 'state'
        )
    FROM updated
    RETURNING audit_event_id
)
SELECT count(*)::bigint FROM updated;

-- The Hub user's conversations and chat requests (MKT-DAT-005): without a
-- conversation, only a request waiting for the Hub user or one they sent and
-- the agency did not accept shows (MKT-HUB-001); any other pointer stays
-- hidden (MKT-CON-006).
-- name: ListHubAgencyConversations :many
SELECT agency_org_did, agency_display_name, agency_domain,
    has_conversation, request, agency_may_write_until, hub_may_write_until,
    last_activity_at, unread_count, read_only_reason, suggestions
FROM vetchium.hub_agency_pointers
WHERE hub_user_did = sqlc.arg(hub_user_did)
  AND (has_conversation OR has_request)
  AND (has_conversation
       OR (request->>'direction' = 'to_hub_user'
           AND request->>'state' = 'pending')
       OR (request->>'direction' = 'to_agency'
           AND request->>'state' <> 'accepted'))
  AND (sqlc.narg(after_activity_at)::timestamptz IS NULL
       OR (last_activity_at, agency_domain) <
           (sqlc.narg(after_activity_at)::timestamptz,
            sqlc.narg(after_agency_domain)::text))
ORDER BY last_activity_at DESC, agency_domain DESC
LIMIT sqlc.arg(page_limit);

-- The conversations waiting on the Hub user (MKT-HUB-001): a chat request to
-- answer, or agency messages not yet read.
-- name: CountHubAwaitingConversations :one
SELECT count(*)::integer AS awaiting
FROM vetchium.hub_agency_pointers
WHERE hub_user_did = sqlc.arg(hub_user_did)
  AND read_only_reason IS NULL
  AND ((has_conversation AND unread_count > 0)
       OR (has_request
           AND request->>'direction' = 'to_hub_user'
           AND request->>'state' = 'pending'));

-- name: GetHubAgencyPointer :one
SELECT hub_user_did, agency_org_did, agency_display_name, agency_domain,
    has_conversation, has_request, request, agency_may_write_until,
    hub_may_write_until, last_activity_at,
    unread_count, read_only_reason, suggestions, pointer_version
FROM vetchium.hub_agency_pointers
WHERE hub_user_did = sqlc.arg(hub_user_did)
  AND agency_org_did = sqlc.arg(agency_org_did);

-- The pointer a portal names by the agency's primary domain. A deleted
-- agency's recorded domain may since belong to another Org (MKT-CNV-012),
-- so a live agency's pointer wins.
-- name: GetHubAgencyPointerByDomain :one
SELECT hub_user_did, agency_org_did, agency_display_name, agency_domain,
    has_conversation, has_request, request, agency_may_write_until,
    hub_may_write_until, last_activity_at,
    unread_count, read_only_reason, suggestions, pointer_version
FROM vetchium.hub_agency_pointers
WHERE hub_user_did = sqlc.arg(hub_user_did)
  AND agency_domain = sqlc.arg(agency_domain)::text
  AND (has_conversation OR has_request)
ORDER BY (read_only_reason IS NULL) DESC, last_activity_at DESC
LIMIT 1;

-- The Hub user's pointers to the agencies an Opening lists (MKT-HUB-005).
-- name: ListHubAgencyPointersForAgencies :many
SELECT agency_org_did, has_conversation, request,
    hub_may_write_until, read_only_reason
FROM vetchium.hub_agency_pointers
WHERE hub_user_did = sqlc.arg(hub_user_did)
  AND agency_org_did = ANY(sqlc.arg(agency_org_dids)::uuid[]);

-- Records the Hub user's request, as the agency confirmed it, before the
-- agency's pointer event arrives; the first event supersedes it. A replay,
-- or the event arriving first, changes nothing.
-- name: RecordHubSentChatRequest :one
WITH recorded AS (
    INSERT INTO vetchium.hub_agency_pointers AS p (
        hub_user_did, agency_org_did, agency_display_name,
        agency_domain, has_request, request, last_activity_at, pointer_version
    )
    VALUES (
        sqlc.arg(hub_user_did), sqlc.arg(agency_org_did),
        sqlc.arg(agency_display_name), sqlc.arg(agency_domain), true,
        sqlc.arg(request)::jsonb,
        (sqlc.arg(request)::jsonb ->> 'sent_at')::timestamptz, 1
    )
    ON CONFLICT (hub_user_did, agency_org_did) DO UPDATE
    SET has_request = true, request = EXCLUDED.request,
        agency_display_name = CASE WHEN p.agency_domain = ''
            THEN EXCLUDED.agency_display_name ELSE p.agency_display_name END,
        agency_domain = CASE WHEN p.agency_domain = ''
            THEN EXCLUDED.agency_domain ELSE p.agency_domain END,
        last_activity_at = GREATEST(p.last_activity_at, EXCLUDED.last_activity_at)
    WHERE NOT p.has_request
        OR (p.request ->> 'sent_at')::timestamptz
            < (EXCLUDED.request ->> 'sent_at')::timestamptz
    RETURNING p.hub_user_did, p.agency_domain
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.agency-chat-request.sent',
        'hub_agency_pointer', recorded.agency_domain, 'hub_user',
        recorded.hub_user_did::text, recorded.hub_user_did, 'hub-api',
        jsonb_build_object(
            'agency_domain', recorded.agency_domain,
            'request_number',
                (sqlc.arg(request)::jsonb ->> 'request_number')::integer
        )
    FROM recorded
    RETURNING audit_event_id
)
SELECT count(*)::bigint FROM recorded;

-- One page of the Hub user's pending requests in one direction, oldest
-- first. A Hub user has one pointer per agency, so the scan stays within
-- their own pointers.
-- name: ListHubPendingChatRequests :many
SELECT agency_org_did, agency_display_name, agency_domain, request,
    (request ->> 'sent_at')::timestamptz AS sent_at
FROM vetchium.hub_agency_pointers
WHERE hub_user_did = sqlc.arg(hub_user_did)
  AND has_request
  AND request ->> 'direction' = sqlc.arg(direction)::text
  AND request ->> 'state' = 'pending'
  AND (sqlc.narg(after_sent_at)::timestamptz IS NULL
      OR ((request ->> 'sent_at')::timestamptz, agency_domain) >
          (sqlc.narg(after_sent_at)::timestamptz,
           sqlc.narg(after_agency_domain)::text))
ORDER BY (request ->> 'sent_at')::timestamptz, agency_domain
LIMIT sqlc.arg(page_limit);

-- One page of the Hub user's answered requests in one direction, newest
-- answer first.
-- name: ListHubAnsweredChatRequests :many
SELECT agency_org_did, agency_display_name, agency_domain, request,
    (request ->> 'answered_at')::timestamptz AS answered_at
FROM vetchium.hub_agency_pointers
WHERE hub_user_did = sqlc.arg(hub_user_did)
  AND has_request
  AND request ->> 'direction' = sqlc.arg(direction)::text
  AND request ->> 'state' <> 'pending'
  AND (sqlc.narg(before_answered_at)::timestamptz IS NULL
      OR ((request ->> 'answered_at')::timestamptz, agency_domain) <
          (sqlc.narg(before_answered_at)::timestamptz,
           sqlc.narg(before_agency_domain)::text))
ORDER BY (request ->> 'answered_at')::timestamptz DESC, agency_domain DESC
LIMIT sqlc.arg(page_limit);

-- name: ListHubAgencyPointersForUser :many
SELECT agency_org_did, pointer_version
FROM vetchium.hub_agency_pointers
WHERE hub_user_did = sqlc.arg(hub_user_did);

-- name: UpdateHubUserAgenciesMayMessage :one
WITH updated AS (
    UPDATE vetchium.hub_users
    SET agencies_may_message = sqlc.arg(agencies_may_message),
        agencies_may_message_version = agencies_may_message_version + 1,
        updated_at = now()
    WHERE hub_user_did = sqlc.arg(hub_user_did)
      AND hub_user_state = 'active'
    RETURNING hub_user_did, agencies_may_message, agencies_may_message_version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.user.agencies-may-message-set',
        'hub_user', updated.hub_user_did::text, 'hub_user',
        updated.hub_user_did::text, updated.hub_user_did, 'hub-api',
        jsonb_build_object('agencies_may_message', updated.agencies_may_message)
    FROM updated
    RETURNING audit_event_id
)
SELECT updated.agencies_may_message, updated.agencies_may_message_version,
    (SELECT count(*) FROM audit) AS audit_rows
FROM updated;

-- name: InsertHubMessageNotice :exec
INSERT INTO vetchium.hub_message_notices (
    hub_user_did, kind, agency_display_name
)
VALUES (
    sqlc.arg(hub_user_did), sqlc.arg(kind), sqlc.arg(agency_display_name)
);

-- name: ClaimHubMessageNotice :one
WITH candidate AS (
    SELECT notice_id
    FROM vetchium.hub_message_notices
    ORDER BY created_at, notice_id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
), claimed AS (
    DELETE FROM vetchium.hub_message_notices AS n
    USING candidate
    WHERE n.notice_id = candidate.notice_id
    RETURNING n.notice_id, n.hub_user_did, n.kind, n.agency_display_name
)
SELECT claimed.notice_id, claimed.hub_user_did, claimed.kind,
    claimed.agency_display_name,
    u.email_address, u.display_name, u.preferred_language, u.hub_user_state
FROM claimed
JOIN vetchium.hub_users AS u ON u.hub_user_did = claimed.hub_user_did;

-- name: QueueHubMessageEmail :one
WITH outbox AS (
    INSERT INTO vetchium.hub_email_outbox (
        kind, recipient_email_address, preferred_language, payload_ciphertext
    )
    VALUES (
        sqlc.arg(kind), sqlc.arg(recipient_email_address),
        sqlc.arg(preferred_language), sqlc.arg(payload_ciphertext)
    )
    RETURNING hub_email_outbox_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.message.notice-queued',
        'hub_user', sqlc.arg(hub_user_did)::text, 'worker',
        'message-notice', 'workers',
        jsonb_build_object('kind', sqlc.arg(kind)::text)
    FROM outbox
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM audit) AS audit_rows;

-- Applies agency-pointer-changed with present=false.
-- name: DeleteHubAgencyPointer :execrows
DELETE FROM vetchium.hub_agency_pointers AS p
WHERE p.hub_user_did = sqlc.arg(hub_user_did)
  AND p.agency_org_did = sqlc.arg(agency_org_did);

-- Each verified professional-email domain with the months of its first and
-- last verification, newest verification first (MKT-PRF-001). Never the
-- address or an instant.
-- name: ListHubVerifiedDomains :many
SELECT e.domain::text AS domain,
    to_char(e.first_verified_at AT TIME ZONE 'UTC', 'YYYY-MM')::text
        AS first_verified_month,
    to_char(e.last_verified_at AT TIME ZONE 'UTC', 'YYYY-MM')::text
        AS last_verified_month
FROM vetchium.hub_professional_emails AS e
WHERE e.hub_user_did = sqlc.arg(hub_user_did)
  AND e.last_verified_at IS NOT NULL
ORDER BY e.last_verified_at DESC, e.professional_email_id;

-- name: ListContactOpeningSuggestions :many
SELECT COALESCE(m.consumer_domain, '')::text AS consumer_domain,
    COALESCE(m.opening_number, 0)::integer AS opening_number,
    m.sent_at
FROM vetchium.org_conversation_messages AS m
WHERE m.org_did = sqlc.arg(org_did)
  AND m.hub_user_did = sqlc.arg(hub_user_did)
  AND (m.kind = 'suggestion'
      OR (m.kind = 'request' AND m.sender_type = 'agency'))
ORDER BY m.sent_at DESC, m.message_number DESC;

-- name: HasHubAgencyPointerSuggestion :one
SELECT EXISTS (
    SELECT 1
    FROM vetchium.hub_agency_pointers AS p,
         jsonb_array_elements(p.suggestions) AS s
    WHERE p.hub_user_did = sqlc.arg(hub_user_did)
      AND p.agency_domain = sqlc.arg(agency_domain)::text
      AND s->>'consumer_domain' = sqlc.arg(consumer_domain)::text
      AND s->>'opening_number' = sqlc.arg(opening_number)::text
) AS has_suggestion;

-- name: ListOrgContactsByHubUsers :many
SELECT c.hub_user_did, c.display_name, c.handle
FROM vetchium.org_contacts AS c
WHERE c.org_did = sqlc.arg(org_did)
  AND c.hub_user_did = ANY(sqlc.arg(hub_user_dids)::uuid[]);
