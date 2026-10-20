-- Serializes Listing writes within an Org and against a plan change, which
-- takes the same row lock (LockOrgForBilling). The plan is read under the lock.
-- name: LockOrgForListings :one
SELECT o.org_did, o.org_plan_oid
FROM vetchium.orgs AS o
WHERE o.org_did = sqlc.arg(org_did) AND o.org_state = 'active'
FOR UPDATE;

-- name: ListOrgListings :many
SELECT l.capability_oid, l.listing_state, l.version, l.headline, l.description,
    l.service_worldwide, l.service_countries, l.languages, l.indicative_price,
    l.check_types, l.consent_disclosure, l.created_at, l.updated_at
FROM vetchium.org_listings AS l
WHERE l.org_did = sqlc.arg(org_did)
ORDER BY l.capability_oid;

-- name: GetOrgListing :one
SELECT l.capability_oid, l.listing_state, l.version, l.headline, l.description,
    l.service_worldwide, l.service_countries, l.languages, l.indicative_price,
    l.check_types, l.consent_disclosure, l.created_at, l.updated_at
FROM vetchium.org_listings AS l
WHERE l.org_did = sqlc.arg(org_did)
  AND l.capability_oid = sqlc.arg(capability_oid);

-- An existing Listing for the Capability is reported through created_rows = 0;
-- the caller holds the Org lock, so the check cannot race.
-- name: CreateOrgListing :one
WITH created AS (
    INSERT INTO vetchium.org_listings (
        org_listing_id, org_did, capability_oid, headline, description,
        service_worldwide, service_countries, languages, indicative_price,
        check_types, consent_disclosure
    )
    VALUES (
        sqlc.arg(listing_id), sqlc.arg(org_did), sqlc.arg(capability_oid),
        sqlc.arg(headline), sqlc.arg(description),
        sqlc.arg(service_worldwide),
        COALESCE(sqlc.arg(service_countries)::text[], '{}'),
        COALESCE(sqlc.arg(languages)::text[], '{}'),
        sqlc.narg(indicative_price),
        COALESCE(sqlc.arg(check_types)::text[], '{}'),
        sqlc.narg(consent_disclosure)
    )
    ON CONFLICT (org_did, capability_oid) DO NOTHING
    RETURNING org_listing_id, capability_oid
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.listing.created', 'org_listing',
        created.org_listing_id::text, 'org_user', sqlc.arg(actor_id)::text,
        'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('action', 'created',
            'capability', created.capability_oid, 'state', 'draft')
    FROM created
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM created) AS created_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- A Listing that is missing or at another version updates nothing; the caller
-- tells the two apart with GetOrgListing.
-- name: UpdateOrgListing :one
WITH previous AS (
    SELECT l.org_listing_id, l.headline, l.description, l.service_worldwide,
        l.service_countries, l.languages, l.indicative_price, l.check_types,
        l.consent_disclosure
    FROM vetchium.org_listings AS l
    WHERE l.org_did = sqlc.arg(org_did)
      AND l.capability_oid = sqlc.arg(capability_oid)
      AND l.version = sqlc.arg(version)
), updated AS (
    UPDATE vetchium.org_listings AS l
    SET headline = sqlc.arg(headline), description = sqlc.arg(description),
        service_worldwide = sqlc.arg(service_worldwide),
        service_countries = COALESCE(sqlc.arg(service_countries)::text[], '{}'),
        languages = COALESCE(sqlc.arg(languages)::text[], '{}'),
        indicative_price = sqlc.narg(indicative_price),
        check_types = COALESCE(sqlc.arg(check_types)::text[], '{}'),
        consent_disclosure = sqlc.narg(consent_disclosure),
        version = l.version + 1, updated_at = now()
    FROM previous AS p
    WHERE l.org_listing_id = p.org_listing_id
    RETURNING l.org_listing_id, l.capability_oid, l.version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.listing.updated', 'org_listing',
        u.org_listing_id::text, 'org_user', sqlc.arg(actor_id)::text,
        'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('action', 'updated',
            'capability', u.capability_oid, 'version', u.version,
            'changed_fields', to_jsonb(array_remove(ARRAY[
                CASE WHEN p.headline IS DISTINCT FROM sqlc.arg(headline)::text
                    THEN 'headline' END,
                CASE WHEN p.description IS DISTINCT FROM sqlc.arg(description)::text
                    THEN 'description' END,
                CASE WHEN p.service_worldwide IS DISTINCT FROM sqlc.arg(service_worldwide)::boolean
                    OR p.service_countries IS DISTINCT FROM
                        COALESCE(sqlc.arg(service_countries)::text[], '{}')
                    THEN 'service' END,
                CASE WHEN p.languages IS DISTINCT FROM
                        COALESCE(sqlc.arg(languages)::text[], '{}')
                    THEN 'languages' END,
                CASE WHEN p.indicative_price IS DISTINCT FROM sqlc.narg(indicative_price)::text
                    THEN 'indicative_price' END,
                CASE WHEN p.check_types IS DISTINCT FROM
                        COALESCE(sqlc.arg(check_types)::text[], '{}')
                    THEN 'check_types' END,
                CASE WHEN p.consent_disclosure IS DISTINCT FROM sqlc.narg(consent_disclosure)::text
                    THEN 'consent_disclosure' END
            ], NULL)))
    FROM updated AS u
    JOIN previous AS p ON p.org_listing_id = u.org_listing_id
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM updated) AS updated_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- Publishing and unlisting. A Listing outside from_states, missing, or at
-- another version changes nothing; the caller tells the cases apart with
-- GetOrgListing.
-- name: SetOrgListingState :one
WITH changed AS (
    UPDATE vetchium.org_listings AS l
    SET listing_state = sqlc.arg(new_state)::vetchium.org_listing_state,
        version = l.version + 1, updated_at = now()
    WHERE l.org_did = sqlc.arg(org_did)
      AND l.capability_oid = sqlc.arg(capability_oid)
      AND l.version = sqlc.arg(version)
      AND l.listing_state::text = ANY(sqlc.arg(from_states)::text[])
    RETURNING l.org_listing_id, l.capability_oid, l.version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), sqlc.arg(audit_action)::text, 'org_listing',
        changed.org_listing_id::text, 'org_user', sqlc.arg(actor_id)::text,
        'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('action', sqlc.arg(audit_action)::text,
            'capability', changed.capability_oid,
            'state', sqlc.arg(new_state)::text, 'version', changed.version)
    FROM changed
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- Only a draft is deleted.
-- name: DeleteOrgListing :one
WITH deleted AS (
    DELETE FROM vetchium.org_listings AS l
    WHERE l.org_did = sqlc.arg(org_did)
      AND l.capability_oid = sqlc.arg(capability_oid)
      AND l.version = sqlc.arg(version)
      AND l.listing_state = 'draft'
    RETURNING l.org_listing_id, l.capability_oid
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.listing.deleted', 'org_listing',
        deleted.org_listing_id::text, 'org_user', sqlc.arg(actor_id)::text,
        'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('action', 'deleted',
            'capability', deleted.capability_oid, 'state', 'draft')
    FROM deleted
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM deleted) AS deleted_rows,
    (SELECT count(*) FROM audit) AS audit_rows;
