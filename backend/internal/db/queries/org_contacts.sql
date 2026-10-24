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

-- name: GetOrgContactByPerson :one
SELECT c.contact_id, c.display_name, c.handle, c.messages_off,
    c.last_activity_at,
    (SELECT count(*) FROM vetchium.org_contact_notes AS n
     WHERE n.contact_id = c.contact_id)::integer AS note_count,
    (conv.conversation_id IS NOT NULL) AS has_conversation,
    CASE WHEN conv.agency_unread THEN 1 ELSE 0 END::integer AS unread_messages_count,
    (
        SELECT count(*)
        FROM vetchium.org_applications AS a
        JOIN vetchium.org_engagements AS eng ON eng.engagement_id = a.credited_engagement_id
        JOIN vetchium.org_applicants AS app ON app.org_applicant_id = a.org_applicant_id
        WHERE eng.provider_org_did = c.org_did
          AND app.hub_user_did = c.hub_user_did
          AND a.removed_at IS NULL
    )::integer AS credited_count
FROM vetchium.org_contacts AS c
LEFT JOIN vetchium.org_conversations AS conv ON conv.contact_id = c.contact_id
WHERE c.org_did = sqlc.arg(org_did)
  AND c.hub_user_did = sqlc.arg(hub_user_did);

-- name: GetOrgContact :one
SELECT c.contact_id, c.hub_user_did, c.display_name, c.handle, c.messages_off,
    c.last_activity_at, c.created_at, u.email_address AS created_by,
    (SELECT count(*) FROM vetchium.org_contact_notes AS n
     WHERE n.contact_id = c.contact_id)::integer AS note_count,
    (conv.conversation_id IS NOT NULL) AS has_conversation,
    CASE WHEN conv.agency_unread THEN 1 ELSE 0 END::integer AS unread_messages_count,
    (
        SELECT count(*)
        FROM vetchium.org_applications AS a
        JOIN vetchium.org_engagements AS eng ON eng.engagement_id = a.credited_engagement_id
        JOIN vetchium.org_applicants AS app ON app.org_applicant_id = a.org_applicant_id
        WHERE eng.provider_org_did = c.org_did
          AND app.hub_user_did = c.hub_user_did
          AND a.removed_at IS NULL
    )::integer AS credited_count
FROM vetchium.org_contacts AS c
JOIN vetchium.org_users AS u ON u.org_user_id = c.created_by
LEFT JOIN vetchium.org_conversations AS conv ON conv.contact_id = c.contact_id
WHERE c.org_did = sqlc.arg(org_did)
  AND c.contact_id = sqlc.arg(contact_id);

-- name: ListOrgContacts :many
SELECT c.contact_id, c.hub_user_did, c.display_name, c.handle, c.messages_off,
    c.last_activity_at,
    (SELECT count(*) FROM vetchium.org_contact_notes AS n
     WHERE n.contact_id = c.contact_id)::integer AS note_count,
    (conv.conversation_id IS NOT NULL) AS has_conversation,
    CASE WHEN conv.agency_unread THEN 1 ELSE 0 END::integer AS unread_messages_count,
    (
        SELECT count(*)
        FROM vetchium.org_applications AS a
        JOIN vetchium.org_engagements AS eng ON eng.engagement_id = a.credited_engagement_id
        JOIN vetchium.org_applicants AS app ON app.org_applicant_id = a.org_applicant_id
        WHERE eng.provider_org_did = c.org_did
          AND app.hub_user_did = c.hub_user_did
          AND a.removed_at IS NULL
    )::integer AS credited_count
FROM vetchium.org_contacts AS c
LEFT JOIN vetchium.org_conversations AS conv ON conv.contact_id = c.contact_id
WHERE c.org_did = sqlc.arg(org_did)
  AND (
      sqlc.arg(filter)::text = 'all'
      OR (sqlc.arg(filter)::text = 'unread' AND conv.agency_unread = true)
      OR (sqlc.arg(filter)::text = 'has_conversation' AND conv.conversation_id IS NOT NULL)
  )
  AND (sqlc.narg(after_activity_at)::timestamptz IS NULL
      OR (c.last_activity_at, c.contact_id) <
          (sqlc.narg(after_activity_at)::timestamptz,
           sqlc.narg(after_contact_id)::uuid))
ORDER BY c.last_activity_at DESC, c.contact_id DESC
LIMIT sqlc.arg(page_limit);

-- Serializes writes to one Contact's notes, so the cap check in the inserting
-- statement cannot race a sibling request. The Contact must be the Org's.
-- name: LockOrgContact :one
SELECT c.contact_id, c.hub_user_did, c.pointer_version, c.messages_off
FROM vetchium.org_contacts AS c
WHERE c.org_did = sqlc.arg(org_did) AND c.contact_id = sqlc.arg(contact_id)
FOR UPDATE;

-- name: ListOrgContactNotes :many
SELECT n.note_id, n.author_id, u.email_address AS author, n.note_text,
    n.created_at, n.edited_at
FROM vetchium.org_contact_notes AS n
JOIN vetchium.org_users AS u ON u.org_user_id = n.author_id
WHERE n.contact_id = sqlc.arg(contact_id)
  AND (sqlc.narg(after_created_at)::timestamptz IS NULL
      OR (n.created_at, n.note_id) <
          (sqlc.narg(after_created_at)::timestamptz,
           sqlc.narg(after_note_id)::uuid))
ORDER BY n.created_at DESC, n.note_id DESC
LIMIT sqlc.arg(page_limit);

-- name: GetOrgContactNoteAuthor :one
SELECT n.author_id
FROM vetchium.org_contact_notes AS n
WHERE n.contact_id = sqlc.arg(contact_id) AND n.note_id = sqlc.arg(note_id);

-- Creates the Contact and counts it toward the day's limit; the caller holds
-- the Org lock and found no Contact for the person.
-- name: CreateOrgContact :one
WITH created AS (
    INSERT INTO vetchium.org_contacts (
        contact_id, org_did, hub_user_did, display_name, handle, created_by
    )
    VALUES (
        sqlc.arg(contact_id), sqlc.arg(org_did), sqlc.arg(hub_user_did),
        sqlc.arg(display_name), sqlc.arg(handle), sqlc.arg(actor_id)
    )
    RETURNING contact_id, created_at, last_activity_at
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
        created.contact_id::text, 'org_user', sqlc.arg(actor_id)::uuid::text,
        sqlc.arg(hub_user_did), sqlc.arg(org_did), 'orgs-api',
        sqlc.arg(idempotency_key), jsonb_build_object('action', 'created')
    FROM created
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM created) AS created_rows,
    (SELECT count(*) FROM counted) AS counted_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- Refreshes the name and handle a Contact records, when they differ from the
-- profile just read (MKT-CON-001). No row changes when they match.
-- name: RefreshOrgContactNames :one
WITH changed AS (
    UPDATE vetchium.org_contacts AS c
    SET display_name = sqlc.arg(display_name), handle = sqlc.arg(handle)
    WHERE c.contact_id = sqlc.arg(contact_id)
      AND c.org_did = sqlc.arg(org_did)
      AND (c.display_name, c.handle) IS DISTINCT FROM
          (sqlc.arg(display_name)::text, sqlc.arg(handle)::text)
    RETURNING c.contact_id, c.hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.contact.refreshed', 'org_contact',
        changed.contact_id::text, 'org_user', sqlc.arg(actor_id)::uuid::text,
        changed.hub_user_did, sqlc.arg(org_did), 'orgs-api',
        sqlc.narg(idempotency_key), jsonb_build_object('action', 'refreshed')
    FROM changed
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- Adds a note and counts it as the Contact's activity. A Contact already at
-- the cap gets no row (has_room is false); the caller holds the Contact lock.
-- name: AddOrgContactNote :one
WITH room AS (
    SELECT count(*) < sqlc.arg(note_limit)::integer AS has_room
    FROM vetchium.org_contact_notes AS n
    WHERE n.contact_id = sqlc.arg(contact_id)
), inserted AS (
    INSERT INTO vetchium.org_contact_notes (
        note_id, contact_id, author_id, note_text
    )
    SELECT sqlc.arg(note_id), sqlc.arg(contact_id), sqlc.arg(actor_id),
        sqlc.arg(note_text)
    FROM room
    WHERE room.has_room
    RETURNING note_id, created_at
), touched AS (
    UPDATE vetchium.org_contacts AS c
    SET last_activity_at = now()
    WHERE c.contact_id = sqlc.arg(contact_id)
      AND EXISTS (SELECT 1 FROM inserted)
    RETURNING c.contact_id, c.hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.contact.note_added', 'org_contact',
        touched.contact_id::text, 'org_user', sqlc.arg(actor_id)::uuid::text,
        touched.hub_user_did, sqlc.arg(org_did), 'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('action', 'note_added',
            'note_id', (SELECT note_id FROM inserted))
    FROM touched
    RETURNING audit_event_id
)
SELECT room.has_room, inserted.note_id, inserted.created_at,
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
    WHERE n.note_id = sqlc.arg(note_id)
      AND n.contact_id = sqlc.arg(contact_id)
      AND n.author_id = sqlc.arg(actor_id)
    RETURNING n.note_id, n.created_at, n.edited_at
), touched AS (
    UPDATE vetchium.org_contacts AS c
    SET last_activity_at = now()
    WHERE c.contact_id = sqlc.arg(contact_id)
      AND EXISTS (SELECT 1 FROM edited)
    RETURNING c.contact_id, c.hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.contact.note_edited', 'org_contact',
        touched.contact_id::text, 'org_user', sqlc.arg(actor_id)::uuid::text,
        touched.hub_user_did, sqlc.arg(org_did), 'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('action', 'note_edited',
            'note_id', sqlc.arg(note_id)::uuid::text)
    FROM touched
    RETURNING audit_event_id
)
SELECT edited.note_id, edited.created_at, edited.edited_at,
    (SELECT u.email_address FROM vetchium.org_users AS u
     WHERE u.org_user_id = sqlc.arg(actor_id)) AS author,
    (SELECT count(*) FROM audit) AS audit_rows
FROM edited;

-- Deletes a note of the Contact. remaining counts the Contact's notes after
-- it, so the caller knows whether the Contact is now empty.
-- name: DeleteOrgContactNote :one
WITH deleted AS (
    DELETE FROM vetchium.org_contact_notes AS n
    WHERE n.note_id = sqlc.arg(note_id) AND n.contact_id = sqlc.arg(contact_id)
    RETURNING n.note_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.contact.note_deleted', 'org_contact',
        sqlc.arg(contact_id)::uuid::text, 'org_user',
        sqlc.arg(actor_id)::uuid::text, sqlc.arg(hub_user_did),
        sqlc.arg(org_did), 'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('action', 'note_deleted',
            'note_id', deleted.note_id)
    FROM deleted
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM deleted) AS deleted_rows,
    (SELECT count(*) FROM audit) AS audit_rows,
    ((SELECT count(*) FROM vetchium.org_contact_notes AS n
      WHERE n.contact_id = sqlc.arg(contact_id))
     - (SELECT count(*) FROM deleted))::integer AS remaining;

-- Deletes the Contact when the deletion of its last note left it with
-- nothing to keep it (MKT-CON-004). No row is returned otherwise.
-- name: DeleteEmptyOrgContact :one
WITH deleted AS (
    DELETE FROM vetchium.org_contacts AS c
    WHERE c.contact_id = sqlc.arg(contact_id)
      AND c.org_did = sqlc.arg(org_did)
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_contact_notes AS n
          WHERE n.contact_id = c.contact_id
      )
    RETURNING c.contact_id, c.hub_user_did, c.pointer_version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, idempotency_key,
        payload
    )
    SELECT sqlc.arg(tenant_id), 'org.contact.deleted', 'org_contact',
        deleted.contact_id::text, 'org_user', sqlc.arg(actor_id)::uuid::text,
        deleted.hub_user_did, sqlc.arg(org_did), 'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('action', 'deleted', 'reason', 'last_note')
    FROM deleted
    RETURNING audit_event_id
)
SELECT deleted.contact_id, deleted.hub_user_did, deleted.pointer_version,
    (SELECT count(*) FROM audit) AS audit_rows
FROM deleted;

-- Contacts whose last note write or message is older than the retention
-- period (MKT-CON-004). The worker re-checks the guard in RetainOrgContact,
-- so a stale list only costs a no-op.
-- name: ListOrgContactsDueForRetention :many
SELECT c.contact_id
FROM vetchium.org_contacts AS c
WHERE c.last_activity_at <= now() - interval '730 days'
ORDER BY c.last_activity_at, c.contact_id
LIMIT sqlc.arg(batch_size);

-- Deletes one Contact with its notes once its retention period has passed.
-- name: RetainOrgContact :one
WITH deleted AS (
    DELETE FROM vetchium.org_contacts AS c
    WHERE c.contact_id = sqlc.arg(contact_id)
      AND c.last_activity_at <= now() - interval '730 days'
    RETURNING c.contact_id, c.org_did, c.hub_user_did, c.pointer_version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.contact.deleted', 'org_contact',
        deleted.contact_id::text, 'worker', 'retain-org-contacts',
        deleted.hub_user_did, deleted.org_did, 'workers',
        jsonb_build_object('action', 'deleted', 'reason', 'retention')
    FROM deleted
    RETURNING audit_event_id
)
SELECT deleted.contact_id, deleted.org_did, deleted.hub_user_did,
    deleted.pointer_version, (SELECT count(*) FROM audit) AS audit_rows
FROM deleted;

-- Deletes a Contact if it has neither notes nor a conversation (MKT-CON-004).
-- name: DeleteContactIfNoNotes :one
WITH deleted AS (
    DELETE FROM vetchium.org_contacts AS c
    WHERE c.contact_id = sqlc.arg(contact_id)
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_contact_notes AS n
          WHERE n.contact_id = c.contact_id
      )
      AND NOT EXISTS (
          SELECT 1 FROM vetchium.org_conversations AS conv
          WHERE conv.contact_id = c.contact_id
      )
    RETURNING c.contact_id, c.org_did, c.hub_user_did, c.pointer_version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, subject_org_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.contact.deleted', 'org_contact',
        deleted.contact_id::text, 'worker', sqlc.arg(source)::text,
        deleted.hub_user_did, deleted.org_did, 'workers',
        jsonb_build_object('action', 'deleted', 'reason', 'no_notes_or_conversation')
    FROM deleted
    RETURNING audit_event_id
)
SELECT deleted.contact_id, deleted.org_did, deleted.hub_user_did,
    deleted.pointer_version, (SELECT count(*) FROM audit) AS audit_rows
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

-- Applies hub-agency-messages-changed at the agency's tenant. The receiver
-- calls it only for an event newer than its watermark, so it overwrites; the
-- receipt's audit event covers the write.
-- name: SetOrgContactMessagesOff :execrows
UPDATE vetchium.org_contacts AS c
SET messages_off = sqlc.arg(messages_off)
WHERE c.contact_id = sqlc.arg(contact_id)
  AND c.org_did = sqlc.arg(org_did)
  AND c.hub_user_did = sqlc.arg(hub_user_did);

-- name: TouchOrgContactPointer :one
UPDATE vetchium.org_contacts AS c
SET last_activity_at = sqlc.arg(last_activity_at),
    pointer_version = pointer_version + 1
WHERE c.contact_id = sqlc.arg(contact_id)
RETURNING c.contact_id, c.pointer_version;

-- Applies hub-account-deleted at the agency's tenant: the notes on the
-- person go at once, and with them the Contact (MKT-DAT-012).
-- name: DeleteOrgContactsOfPerson :execrows
DELETE FROM vetchium.org_contacts AS c
WHERE c.org_did = sqlc.arg(org_did)
  AND c.hub_user_did = sqlc.arg(hub_user_did);

-- The Hub user's side of agency Contacts: the messages setting and its
-- version, for an account that can be reached.
-- name: GetHubUserAgencyState :one
SELECT u.agencies_may_message, u.agencies_may_message_version
FROM vetchium.hub_users AS u
WHERE u.hub_user_did = sqlc.arg(hub_user_did)
  AND u.hub_user_state = 'active';

-- Applies agency-pointer-changed with present=true at the Hub user's tenant.
-- name: InsertHubAgencyPointer :execrows
INSERT INTO vetchium.hub_agency_pointers (
    contact_id, hub_user_did, agency_org_did
)
VALUES (
    sqlc.arg(contact_id), sqlc.arg(hub_user_did), sqlc.arg(agency_org_did)
)
ON CONFLICT (contact_id) DO NOTHING;

-- name: UpsertHubAgencyPointer :execrows
INSERT INTO vetchium.hub_agency_pointers (
    contact_id, hub_user_did, agency_org_did,
    agency_display_name, agency_domain, agency_logo_media_id,
    has_conversation, last_activity_at, unread_count,
    read_only_reason, suggestions, pointer_version
)
VALUES (
    sqlc.arg(contact_id), sqlc.arg(hub_user_did), sqlc.arg(agency_org_did),
    sqlc.arg(agency_display_name), sqlc.arg(agency_domain), sqlc.narg(agency_logo_media_id),
    sqlc.arg(has_conversation), sqlc.arg(last_activity_at), sqlc.arg(unread_count),
    sqlc.narg(read_only_reason), sqlc.arg(suggestions), sqlc.arg(pointer_version)
)
ON CONFLICT (contact_id) DO UPDATE
SET agency_org_did = EXCLUDED.agency_org_did,
    agency_display_name = EXCLUDED.agency_display_name,
    agency_domain = EXCLUDED.agency_domain,
    agency_logo_media_id = EXCLUDED.agency_logo_media_id,
    has_conversation = EXCLUDED.has_conversation,
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
    WHERE contact_id = sqlc.arg(contact_id)
      AND hub_user_did = sqlc.arg(hub_user_did)
      AND unread_count > 0
    RETURNING contact_id, hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.agency-conversation.marked-read',
        'hub_agency_pointer', updated.contact_id::text, 'hub_user',
        updated.hub_user_did::text, updated.hub_user_did, 'hub-api',
        jsonb_build_object('contact_id', updated.contact_id::text)
    FROM updated
    RETURNING audit_event_id
)
SELECT count(*)::bigint FROM updated;

-- name: MarkHubAgencyPointerConversationDeleted :one
WITH updated AS (
    UPDATE vetchium.hub_agency_pointers
    SET has_conversation = false,
        unread_count = 0
    WHERE contact_id = sqlc.arg(contact_id)
      AND hub_user_did = sqlc.arg(hub_user_did)
    RETURNING contact_id, hub_user_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_hub_user_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'hub.agency-conversation.deleted',
        'hub_agency_pointer', updated.contact_id::text, 'hub_user',
        updated.hub_user_did::text, updated.hub_user_did, 'hub-api',
        jsonb_build_object('contact_id', updated.contact_id::text)
    FROM updated
    RETURNING audit_event_id
)
SELECT count(*)::bigint FROM updated;

-- name: ListHubAgencyConversations :many
SELECT contact_id, agency_org_did, agency_display_name, agency_domain,
    agency_logo_media_id, has_conversation, last_activity_at,
    unread_count, read_only_reason, suggestions
FROM vetchium.hub_agency_pointers
WHERE hub_user_did = sqlc.arg(hub_user_did)
  AND has_conversation = true
  AND (sqlc.narg(after_activity_at)::timestamptz IS NULL
       OR (last_activity_at, contact_id) <
           (sqlc.narg(after_activity_at)::timestamptz,
            sqlc.narg(after_contact_id)::uuid))
ORDER BY last_activity_at DESC, contact_id DESC
LIMIT sqlc.arg(page_limit);

-- name: GetHubAgencyPointer :one
SELECT contact_id, hub_user_did, agency_org_did, agency_display_name, agency_domain,
    agency_logo_media_id, has_conversation, last_activity_at,
    unread_count, read_only_reason, suggestions, pointer_version
FROM vetchium.hub_agency_pointers
WHERE contact_id = sqlc.arg(contact_id)
  AND hub_user_did = sqlc.arg(hub_user_did);

-- name: SetHubAgencyPointersReadOnlyReasonForUser :execrows
UPDATE vetchium.hub_agency_pointers
SET read_only_reason = sqlc.narg(read_only_reason)
WHERE hub_user_did = sqlc.arg(hub_user_did)
  AND (
      (sqlc.narg(read_only_reason)::text IS NOT NULL AND read_only_reason IS NULL)
      OR
      (sqlc.narg(read_only_reason)::text IS NULL AND read_only_reason = 'messages_off')
  );

-- name: ListHubAgencyPointersForUser :many
SELECT contact_id, agency_org_did, pointer_version
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
    hub_user_did, agency_display_name
)
VALUES (
    sqlc.arg(hub_user_did), sqlc.arg(agency_display_name)
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
    RETURNING n.notice_id, n.hub_user_did, n.agency_display_name
)
SELECT claimed.notice_id, claimed.hub_user_did, claimed.agency_display_name,
    u.email_address, u.display_name, u.preferred_language, u.hub_user_state
FROM claimed
JOIN vetchium.hub_users AS u ON u.hub_user_did = claimed.hub_user_did;

-- name: QueueHubMessageEmail :one
WITH outbox AS (
    INSERT INTO vetchium.hub_email_outbox (
        kind, recipient_email_address, preferred_language, payload_ciphertext
    )
    VALUES (
        'agency-message-received', sqlc.arg(recipient_email_address),
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
        jsonb_build_object('kind', 'agency-message-received'::text)
    FROM outbox
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM audit) AS audit_rows;

-- Applies agency-pointer-changed with present=false.
-- name: DeleteHubAgencyPointer :execrows
DELETE FROM vetchium.hub_agency_pointers AS p
WHERE p.contact_id = sqlc.arg(contact_id)
  AND p.hub_user_did = sqlc.arg(hub_user_did);

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
JOIN vetchium.org_conversations AS c ON c.conversation_id = m.conversation_id
WHERE c.contact_id = sqlc.arg(contact_id)
  AND m.kind = 'suggestion'
ORDER BY m.sent_at DESC, m.message_id DESC;

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
SELECT c.contact_id, c.hub_user_did, c.display_name, c.handle
FROM vetchium.org_contacts AS c
WHERE c.org_did = sqlc.arg(org_did)
  AND c.hub_user_did = ANY(sqlc.arg(hub_user_dids)::uuid[]);
