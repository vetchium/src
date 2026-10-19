-- Offers (agent-guides/hiring-pipeline.md, HP-WRK-008 and States). Every
-- writer takes the application's row lock before touching its offers, so an
-- offer row is never locked ahead of its application.

-- The caller holds the application lock and claimed the letter in this
-- transaction. The offer number follows the application's last offer.
-- name: ExtendOrgApplicationOffer :one
WITH changed AS (
    UPDATE vetchium.org_applications AS a
    SET application_state = 'offered', offer_extended_at = now(),
        version = a.version + 1, updated_at = now()
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state = 'in_pipeline'
    RETURNING a.org_application_id
), offer AS (
    INSERT INTO vetchium.org_application_offers (
        org_application_offer_id, org_application_id, offer_number,
        letter_object_id, proposed_joining_date, respond_by, extended_by
    )
    SELECT gen_random_uuid(), changed.org_application_id,
        COALESCE((
            SELECT max(o.offer_number)
            FROM vetchium.org_application_offers AS o
            WHERE o.org_application_id = changed.org_application_id
        ), 0) + 1,
        sqlc.arg(letter_object_id), sqlc.narg(proposed_joining_date)::date,
        now() + make_interval(days => sqlc.arg(respond_within_days)::integer),
        sqlc.arg(actor_id)
    FROM changed
    RETURNING org_application_id
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM offer) AS offer_rows;

-- name: WithdrawOrgApplicationOffer :one
WITH changed AS (
    UPDATE vetchium.org_applications AS a
    SET application_state = 'in_pipeline', version = a.version + 1,
        updated_at = now()
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state = 'offered'
    RETURNING a.org_application_id
), ended AS (
    UPDATE vetchium.org_application_offers AS o
    SET offer_status = 'withdrawn', ended_at = now()
    FROM changed
    WHERE o.org_application_id = changed.org_application_id
      AND o.offer_status = 'extended'
    RETURNING o.org_application_id
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM ended) AS ended_rows;

-- The applicant answers the extended offer they read, before its deadline.
-- The caller holds the application lock from LockOrgApplicationForApplicant.
-- name: AnswerOrgApplicationOffer :one
WITH changed AS (
    UPDATE vetchium.org_applications AS a
    SET application_state = CASE WHEN sqlc.arg(accept)::boolean
            THEN 'offer_accepted'::vetchium.org_application_state
            ELSE 'offer_declined'::vetchium.org_application_state END,
        version = a.version + 1, updated_at = now()
    FROM vetchium.org_application_offers AS o
    WHERE a.org_application_id = sqlc.arg(application_id)
      AND a.version = sqlc.arg(version)::integer
      AND a.application_state = 'offered'
      AND o.org_application_id = a.org_application_id
      AND o.offer_number = sqlc.arg(offer_number)::integer
      AND o.offer_status = 'extended'
      AND o.respond_by > now()
    RETURNING a.org_application_id, a.application_number,
        a.application_state, a.version, o.org_application_offer_id
), answered AS (
    UPDATE vetchium.org_application_offers AS o
    SET offer_status = CASE WHEN sqlc.arg(accept)::boolean
            THEN 'accepted'::vetchium.org_application_offer_status
            ELSE 'declined'::vetchium.org_application_offer_status END,
        ended_at = now()
    FROM changed
    WHERE o.org_application_offer_id = changed.org_application_offer_id
    RETURNING o.org_application_id
), history AS (
    INSERT INTO vetchium.org_application_history (
        org_application_history_id, org_application_id, action, actor_kind,
        application_state, application_version
    )
    SELECT sqlc.arg(history_id), changed.org_application_id,
        CASE WHEN sqlc.arg(accept)::boolean
            THEN 'offer_accepted'::vetchium.org_application_history_action
            ELSE 'offer_declined'::vetchium.org_application_history_action
        END,
        'applicant', changed.application_state, changed.version
    FROM changed
    RETURNING org_application_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id),
        CASE WHEN sqlc.arg(accept)::boolean THEN 'org.application.offer_accepted'
            ELSE 'org.application.offer_declined' END,
        'org_application',
        sqlc.arg(org_did)::uuid::text || ':' ||
            sqlc.arg(opening_number)::integer::text || ':' ||
            changed.application_number::text,
        'hub_user', sqlc.arg(hub_user_did)::text, sqlc.arg(org_did),
        'federation-command', sqlc.arg(command_id)::text,
        jsonb_build_object('opening_number', sqlc.arg(opening_number)::integer,
            'application_number', changed.application_number,
            'action', CASE WHEN sqlc.arg(accept)::boolean
                THEN 'offer_accepted' ELSE 'offer_declined' END,
            'offer_number', sqlc.arg(offer_number)::integer,
            'state', changed.application_state::text,
            'version', changed.version,
            'source_tenant_id', sqlc.arg(source_tenant_id)::text)
    FROM changed
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM answered) AS answered_rows,
    (SELECT count(*) FROM history) AS history_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- Locks a batch of offered applications whose extended offer's deadline
-- passed. ExpireOrgApplicationOffers then decides on fresh reads under these
-- locks, so an offer withdrawn or replaced meanwhile is never expired.
-- name: LockDueOrgApplicationOffers :many
SELECT a.org_application_id
FROM vetchium.org_application_offers AS o
JOIN vetchium.org_applications AS a
    ON a.org_application_id = o.org_application_id
WHERE o.offer_status = 'extended'
  AND o.respond_by <= now()
  AND a.application_state = 'offered'
ORDER BY o.respond_by, o.org_application_offer_id
LIMIT 100
FOR UPDATE OF a SKIP LOCKED;

-- An unanswered offer counts as declined (States): the application moves to
-- offer_declined and the offer to expired, with history and audit.
-- name: ExpireOrgApplicationOffers :many
WITH changed AS (
    UPDATE vetchium.org_applications AS a
    SET application_state = 'offer_declined', version = a.version + 1,
        updated_at = now()
    FROM vetchium.org_application_offers AS o
    WHERE a.org_application_id = ANY(sqlc.arg(application_ids)::uuid[])
      AND a.application_state = 'offered'
      AND o.org_application_id = a.org_application_id
      AND o.offer_status = 'extended'
      AND o.respond_by <= now()
    RETURNING a.org_application_id, a.org_opening_id, a.application_number,
        a.application_state, a.version, o.org_application_offer_id,
        o.offer_number
), expired AS (
    UPDATE vetchium.org_application_offers AS o
    SET offer_status = 'expired', ended_at = now()
    FROM changed
    WHERE o.org_application_offer_id = changed.org_application_offer_id
    RETURNING o.org_application_id
), history AS (
    INSERT INTO vetchium.org_application_history (
        org_application_history_id, org_application_id, action, actor_kind,
        application_state, application_version, created_at
    )
    SELECT gen_random_uuid(), changed.org_application_id, 'offer_declined',
        'system', changed.application_state, changed.version,
        clock_timestamp()
    FROM changed
    RETURNING org_application_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.application.offer_expired',
        'org_application',
        o.org_did::text || ':' || o.opening_number::text || ':' ||
            changed.application_number::text,
        'worker', 'offer-expiry', o.org_did, 'workers',
        jsonb_build_object('opening_number', o.opening_number,
            'application_number', changed.application_number,
            'action', 'offer_declined', 'offer_number', changed.offer_number,
            'state', changed.application_state::text,
            'version', changed.version)
    FROM changed
    JOIN vetchium.org_openings AS o ON o.org_opening_id = changed.org_opening_id
    RETURNING audit_event_id
)
SELECT changed.org_application_id,
    (SELECT count(*) FROM expired) AS expired_rows,
    (SELECT count(*) FROM history) AS history_rows,
    (SELECT count(*) FROM audit) AS audit_rows
FROM changed;
