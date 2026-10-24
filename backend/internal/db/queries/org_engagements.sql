-- The snapshot queries return one column list from the consumer's view and
-- the provider's projection, so both map through one Go function.

-- name: GetOrgEngagementSnapshot :one
SELECT engagement_id, version, consumer_org_did, consumer_domain,
    consumer_display_name, provider_org_did, provider_domain,
    provider_display_name, capability_oid, engagement_state, state_rank,
    message, consumer_reference, provider_reference, end_note, ended_by,
    proposed_at, expires_at, decided_at, ended_at, updated_at
FROM vetchium.org_engagement_snapshots
WHERE engagement_id = sqlc.arg(engagement_id);

-- name: GetOrgEngagementSnapshots :many
SELECT engagement_id, version, consumer_org_did, consumer_domain,
    consumer_display_name, provider_org_did, provider_domain,
    provider_display_name, capability_oid, engagement_state, state_rank,
    message, consumer_reference, provider_reference, end_note, ended_by,
    proposed_at, expires_at, decided_at, ended_at, updated_at
FROM vetchium.org_engagement_snapshots
WHERE engagement_id = ANY(sqlc.arg(engagement_ids)::uuid[]);

-- name: GetConsumerEngagement :one
SELECT engagement_id, version, consumer_org_did, consumer_domain,
    consumer_display_name, provider_org_did, provider_domain,
    provider_display_name, capability_oid, engagement_state, state_rank,
    message, consumer_reference, provider_reference, end_note, ended_by,
    proposed_at, expires_at, decided_at, ended_at, updated_at
FROM vetchium.org_engagement_snapshots
WHERE engagement_id = sqlc.arg(engagement_id)
  AND consumer_org_did = sqlc.arg(org_did);

-- name: ListConsumerEngagements :many
SELECT engagement_id, version, consumer_org_did, consumer_domain,
    consumer_display_name, provider_org_did, provider_domain,
    provider_display_name, capability_oid, engagement_state, state_rank,
    message, consumer_reference, provider_reference, end_note, ended_by,
    proposed_at, expires_at, decided_at, ended_at, updated_at
FROM vetchium.org_engagement_snapshots
WHERE consumer_org_did = sqlc.arg(org_did)
  AND (sqlc.narg(state)::text IS NULL OR engagement_state::text = sqlc.narg(state)::text)
  AND (sqlc.narg(capability_oid)::text IS NULL OR capability_oid = sqlc.narg(capability_oid)::text)
  AND (sqlc.narg(after_id)::uuid IS NULL
      OR state_rank > sqlc.narg(after_rank)::smallint
      OR (state_rank = sqlc.narg(after_rank)::smallint
          AND (proposed_at < sqlc.narg(after_at)::timestamptz
              OR (proposed_at = sqlc.narg(after_at)::timestamptz
                  AND engagement_id < sqlc.narg(after_id)::uuid))))
ORDER BY state_rank, proposed_at DESC, engagement_id DESC
LIMIT sqlc.arg(page_limit);

-- name: GetProviderEngagement :one
SELECT engagement_id, version, consumer_org_did, consumer_domain,
    consumer_display_name, provider_org_did, provider_domain,
    provider_display_name, capability_oid, engagement_state, state_rank,
    message, consumer_reference, provider_reference, end_note, ended_by,
    proposed_at, expires_at, decided_at, ended_at, updated_at
FROM vetchium.org_engagement_projections
WHERE engagement_id = sqlc.arg(engagement_id)
  AND provider_org_did = sqlc.arg(org_did);

-- name: ListProviderEngagements :many
SELECT engagement_id, version, consumer_org_did, consumer_domain,
    consumer_display_name, provider_org_did, provider_domain,
    provider_display_name, capability_oid, engagement_state, state_rank,
    message, consumer_reference, provider_reference, end_note, ended_by,
    proposed_at, expires_at, decided_at, ended_at, updated_at
FROM vetchium.org_engagement_projections
WHERE provider_org_did = sqlc.arg(org_did)
  AND (sqlc.narg(state)::text IS NULL OR engagement_state::text = sqlc.narg(state)::text)
  AND (sqlc.narg(capability_oid)::text IS NULL OR capability_oid = sqlc.narg(capability_oid)::text)
  AND (sqlc.narg(after_id)::uuid IS NULL
      OR state_rank > sqlc.narg(after_rank)::smallint
      OR (state_rank = sqlc.narg(after_rank)::smallint
          AND (proposed_at < sqlc.narg(after_at)::timestamptz
              OR (proposed_at = sqlc.narg(after_at)::timestamptz
                  AND engagement_id < sqlc.narg(after_id)::uuid))))
ORDER BY state_rank, proposed_at DESC, engagement_id DESC
LIMIT sqlc.arg(page_limit);

-- The caller's side and the engagement's current version and state, to name
-- why a change that matched no row changed nothing.
-- name: GetOrgEngagementStanding :one
SELECT consumer_org_did, provider_org_did, version, engagement_state
FROM vetchium.org_engagements
WHERE engagement_id = sqlc.arg(engagement_id);

-- A second live engagement for the pair and Capability is reported through
-- created_rows = 0 by the partial unique index, so two proposals racing
-- cannot both succeed.
-- name: CreateOrgEngagement :one
WITH created AS (
    INSERT INTO vetchium.org_engagements (
        engagement_id, consumer_org_did, provider_org_did, provider_domain,
        provider_display_name, capability_oid, message, expires_at
    )
    VALUES (
        sqlc.arg(engagement_id), sqlc.arg(consumer_org_did),
        sqlc.arg(provider_org_did), sqlc.arg(provider_domain),
        sqlc.arg(provider_display_name), sqlc.arg(capability_oid),
        sqlc.narg(message), now() + make_interval(days => sqlc.arg(lifetime_days)::integer)
    )
    ON CONFLICT (consumer_org_did, provider_org_did, capability_oid)
        WHERE engagement_state IN ('proposed', 'active') DO NOTHING
    RETURNING engagement_id, capability_oid
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.engagement.proposed', 'org_engagement',
        created.engagement_id::text, 'org_user', sqlc.arg(actor_id)::text,
        sqlc.arg(consumer_org_did), 'orgs-api', sqlc.arg(idempotency_key),
        jsonb_build_object('action', 'proposed',
            'capability', created.capability_oid, 'version', 1,
            'provider_org_did', sqlc.arg(provider_org_did)::uuid::text)
    FROM created
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM created) AS created_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- One audited change of an engagement by either party: a transition, a
-- reference, or both. The consumer's tenant runs it, for its own users and
-- for the provider's commands. provider_org_did, when given, must be the
-- engagement's provider. A change that matches no row (unknown, another
-- party's, another version, or a state outside from_states) changes nothing.
-- name: ChangeOrgEngagement :one
WITH changed AS (
    UPDATE vetchium.org_engagements AS e
    SET engagement_state = COALESCE(
            sqlc.narg(new_state)::vetchium.org_engagement_state,
            e.engagement_state),
        version = e.version + 1, updated_at = now(),
        decided_at = CASE WHEN sqlc.arg(set_decided)::boolean
            THEN now() ELSE e.decided_at END,
        ended_by = COALESCE(
            sqlc.narg(ended_by)::vetchium.org_engagement_party, e.ended_by),
        ended_at = CASE WHEN sqlc.narg(ended_by)::vetchium.org_engagement_party
            IS NOT NULL THEN now() ELSE e.ended_at END,
        end_note = CASE WHEN sqlc.narg(ended_by)::vetchium.org_engagement_party
            IS NOT NULL THEN sqlc.narg(end_note)::text ELSE e.end_note END,
        consumer_reference = CASE WHEN sqlc.arg(reference_party)::text = 'consumer'
            THEN sqlc.narg(reference)::text ELSE e.consumer_reference END,
        provider_reference = CASE WHEN sqlc.arg(reference_party)::text = 'provider'
            THEN sqlc.narg(reference)::text ELSE e.provider_reference END,
        provider_display_name = COALESCE(
            sqlc.narg(provider_display_name)::text, e.provider_display_name)
    WHERE e.engagement_id = sqlc.arg(engagement_id)
      AND e.consumer_org_did = sqlc.arg(consumer_org_did)
      AND (sqlc.narg(provider_org_did)::uuid IS NULL
          OR e.provider_org_did = sqlc.narg(provider_org_did)::uuid)
      AND e.version = sqlc.arg(version)::integer
      AND e.engagement_state::text = ANY(sqlc.arg(from_states)::text[])
    RETURNING e.engagement_id, e.version, e.engagement_state,
        e.capability_oid, e.provider_org_did
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, idempotency_key, payload
    )
    SELECT sqlc.arg(tenant_id), sqlc.arg(audit_action)::text, 'org_engagement',
        changed.engagement_id::text, sqlc.arg(actor_type)::text,
        sqlc.arg(actor_id)::text, sqlc.arg(consumer_org_did),
        sqlc.arg(source)::text, sqlc.narg(idempotency_key)::text,
        jsonb_strip_nulls(jsonb_build_object(
            'action', sqlc.arg(audit_action)::text,
            'version', changed.version, 'state', changed.engagement_state,
            'capability', changed.capability_oid,
            'provider_org_did', changed.provider_org_did::text,
            'actor_display_name', sqlc.narg(actor_display_name)::text,
            'source_tenant_id', sqlc.narg(source_tenant_id)::text))
    FROM changed
    RETURNING audit_event_id
)
SELECT (SELECT count(*) FROM changed) AS changed_rows,
    (SELECT count(*) FROM audit) AS audit_rows;

-- Proposals past their deadline, locked for one batch.
-- name: LockDueOrgEngagements :many
SELECT engagement_id
FROM vetchium.org_engagements
WHERE engagement_state = 'proposed' AND expires_at <= now()
ORDER BY expires_at, engagement_id
LIMIT sqlc.arg(batch_size)
FOR UPDATE SKIP LOCKED;

-- name: ExpireOrgEngagements :many
WITH expired AS (
    UPDATE vetchium.org_engagements AS e
    SET engagement_state = 'expired', version = e.version + 1,
        updated_at = now()
    WHERE e.engagement_id = ANY(sqlc.arg(engagement_ids)::uuid[])
      AND e.engagement_state = 'proposed' AND e.expires_at <= now()
    RETURNING e.engagement_id, e.consumer_org_did, e.version
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        subject_org_did, source, payload
    )
    SELECT sqlc.arg(tenant_id), 'org.engagement.expired', 'org_engagement',
        expired.engagement_id::text, 'worker', 'expire-org-engagements',
        expired.consumer_org_did, 'workers',
        jsonb_build_object('action', 'expired', 'version', expired.version,
            'state', 'expired')
    FROM expired
    RETURNING audit_event_id
)
SELECT expired.engagement_id, (SELECT count(*) FROM audit) AS audit_rows
FROM expired;

-- Applies engagement-changed at the provider's tenant. The receiver calls it
-- only for an event newer than its watermark, so it overwrites. An Org that is
-- not here projects nothing.
-- name: UpsertOrgEngagementProjection :execrows
INSERT INTO vetchium.org_engagement_projections (
    engagement_id, provider_org_did, version, consumer_org_did,
    consumer_domain, consumer_display_name, provider_domain,
    provider_display_name, capability_oid, engagement_state, message,
    consumer_reference, provider_reference, end_note, ended_by, proposed_at,
    expires_at, decided_at, ended_at, updated_at
)
SELECT sqlc.arg(engagement_id), o.org_did, sqlc.arg(version),
    sqlc.arg(consumer_org_did), sqlc.arg(consumer_domain),
    sqlc.arg(consumer_display_name), sqlc.arg(provider_domain),
    sqlc.arg(provider_display_name), sqlc.arg(capability_oid),
    sqlc.arg(engagement_state)::vetchium.org_engagement_state,
    sqlc.narg(message), sqlc.narg(consumer_reference),
    sqlc.narg(provider_reference), sqlc.narg(end_note),
    sqlc.narg(ended_by)::vetchium.org_engagement_party,
    sqlc.arg(proposed_at), sqlc.arg(expires_at), sqlc.narg(decided_at),
    sqlc.narg(ended_at), sqlc.arg(updated_at)
FROM vetchium.orgs AS o
WHERE o.org_did = sqlc.arg(provider_org_did)
ON CONFLICT (engagement_id) DO UPDATE
SET version = EXCLUDED.version, consumer_domain = EXCLUDED.consumer_domain,
    consumer_display_name = EXCLUDED.consumer_display_name,
    provider_domain = EXCLUDED.provider_domain,
    provider_display_name = EXCLUDED.provider_display_name,
    engagement_state = EXCLUDED.engagement_state, message = EXCLUDED.message,
    consumer_reference = EXCLUDED.consumer_reference,
    provider_reference = EXCLUDED.provider_reference,
    end_note = EXCLUDED.end_note, ended_by = EXCLUDED.ended_by,
    expires_at = EXCLUDED.expires_at, decided_at = EXCLUDED.decided_at,
    ended_at = EXCLUDED.ended_at, updated_at = EXCLUDED.updated_at,
    received_at = now();

-- The provider's active `sourcing` engagement with a client, from the
-- projection this tenant keeps; the client's tenant decides the rest.
-- name: GetActiveSourcingEngagementWithClient :one
SELECT p.engagement_id, p.consumer_org_did
FROM vetchium.org_engagement_projections AS p
WHERE p.provider_org_did = sqlc.arg(provider_org_did)
  AND p.consumer_domain = sqlc.arg(consumer_domain)
  AND p.capability_oid = 'sourcing'
  AND p.engagement_state = 'active';
