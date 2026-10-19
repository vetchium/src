-- Applications whose last projection event judged an interview as awaiting
-- the applicant, and whose start has now passed (HP-HUB-007).
-- name: LockOrgApplicationsDueForHubRefresh :many
SELECT a.org_application_id
FROM vetchium.org_applications AS a
WHERE a.hub_refresh_at <= now()
ORDER BY a.hub_refresh_at, a.org_application_id
LIMIT 100
FOR UPDATE OF a SKIP LOCKED;

-- Re-reports applications to their applicants without changing what the Org
-- sees: the version moves so the projection event is newer than the last,
-- and updated_at stays, so "last activity" does not. The caller enqueues the
-- events in the same transaction.
-- name: BumpOrgApplicationsForHubRefresh :many
WITH bumped AS (
    UPDATE vetchium.org_applications AS a
    SET version = a.version + 1
    WHERE a.org_application_id = ANY(sqlc.arg(application_ids)::uuid[])
      AND a.hub_refresh_at <= now()
    RETURNING a.org_application_id, a.org_opening_id, a.application_number,
        a.version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.application.hub-projection-refreshed',
        'org_application',
        o.org_did::text || ':' || o.opening_number::text || ':' ||
            bumped.application_number::text,
        'worker', 'hub-projection-refresh', o.org_did, 'workers',
        jsonb_build_object('opening_number', o.opening_number,
            'application_number', bumped.application_number,
            'version', bumped.version)
    FROM bumped
    JOIN vetchium.org_openings AS o ON o.org_opening_id = bumped.org_opening_id
    RETURNING audit_event_id
)
SELECT bumped.org_application_id,
    (SELECT count(*) FROM bumped) AS bumped_rows,
    (SELECT count(*) FROM audit) AS audit_rows
FROM bumped;

-- Offered applications whose extended offer ends within a day and whose
-- applicant was not told yet. An offer given only a day to answer has no
-- warning to give: it is a day away from the moment it was extended.
-- name: LockOrgApplicationsWithExpiringOffers :many
SELECT a.org_application_id
FROM vetchium.org_application_offers AS o
JOIN vetchium.org_applications AS a
    ON a.org_application_id = o.org_application_id
WHERE o.offer_status = 'extended' AND o.expiring_notified_at IS NULL
  AND o.respond_by > now() AND o.respond_by <= now() + interval '24 hours'
  AND o.respond_by - o.extended_at > interval '24 hours'
  AND a.application_state = 'offered'
ORDER BY o.respond_by, o.org_application_offer_id
LIMIT 100
FOR UPDATE OF a SKIP LOCKED;

-- name: MarkOrgApplicationOffersExpiring :many
WITH marked AS (
    UPDATE vetchium.org_application_offers AS o
    SET expiring_notified_at = now()
    FROM vetchium.org_applications AS a
    WHERE a.org_application_id = ANY(sqlc.arg(application_ids)::uuid[])
      AND o.org_application_id = a.org_application_id
      AND o.offer_status = 'extended' AND o.expiring_notified_at IS NULL
      AND o.respond_by > now() AND o.respond_by <= now() + interval '24 hours'
      AND a.application_state = 'offered'
    RETURNING o.org_application_id, o.offer_number
), bumped AS (
    UPDATE vetchium.org_applications AS a
    SET version = a.version + 1
    FROM marked
    WHERE a.org_application_id = marked.org_application_id
    RETURNING a.org_application_id, a.org_opening_id, a.application_number,
        a.version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.application.offer-expiring-notified',
        'org_application',
        o.org_did::text || ':' || o.opening_number::text || ':' ||
            bumped.application_number::text,
        'worker', 'offer-expiring-notice', o.org_did, 'workers',
        jsonb_build_object('opening_number', o.opening_number,
            'application_number', bumped.application_number,
            'offer_number', marked.offer_number, 'version', bumped.version)
    FROM bumped
    JOIN marked ON marked.org_application_id = bumped.org_application_id
    JOIN vetchium.org_openings AS o ON o.org_opening_id = bumped.org_opening_id
    RETURNING audit_event_id
)
SELECT bumped.org_application_id,
    (SELECT count(*) FROM marked) AS marked_rows,
    (SELECT count(*) FROM bumped) AS bumped_rows,
    (SELECT count(*) FROM audit) AS audit_rows
FROM bumped;
