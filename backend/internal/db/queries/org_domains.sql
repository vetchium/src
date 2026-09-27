-- Domain re-verification. Every write is guarded by the state the caller
-- read, so a scheduled check and a superadmin's check-now cannot both apply a
-- stale result.

-- name: ListDueOrgDomains :many
SELECT
    d.org_did,
    d.domain,
    d.verification_token,
    d.domain_state,
    d.last_conclusive_at,
    d.consecutive_inconclusive
FROM vetchium.org_domains AS d
JOIN vetchium.orgs AS o ON o.org_did = d.org_did
WHERE d.next_check_at <= now()
  AND d.domain_state IN ('verified', 'failing', 'released')
  AND o.org_state IN ('active', 'suspended')
ORDER BY d.next_check_at, d.org_did
LIMIT 25;

-- name: GetOrgDomainForCheck :one
SELECT
    d.org_did,
    d.domain,
    d.verification_token,
    d.domain_state,
    d.last_conclusive_at,
    d.consecutive_inconclusive
FROM vetchium.org_domains AS d
JOIN vetchium.orgs AS o ON o.org_did = d.org_did
WHERE d.org_did = sqlc.arg(org_did)
  AND o.org_state IN ('active', 'suspended');

-- name: RecordOrgDomainPresent :one
WITH updated AS (
    UPDATE vetchium.org_domains
    SET domain_state = 'verified',
        consecutive_failures = 0,
        consecutive_inconclusive = 0,
        last_verified_at = now(),
        last_conclusive_at = now(),
        failing_since = NULL,
        next_check_at = sqlc.arg(next_check_at),
        updated_at = now()
    WHERE org_did = sqlc.arg(org_did)
      AND domain_state = sqlc.arg(expected_state)
      AND domain_state IN ('verified', 'failing')
    RETURNING org_did, domain
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.domain.checked',
        'org_domain',
        org_did::text,
        sqlc.arg(actor_type),
        sqlc.arg(actor_id),
        sqlc.arg(source),
        jsonb_build_object(
            'domain', domain,
            'result', 'present',
            'previous_state', sqlc.arg(expected_state)::text,
            'state', 'verified'
        )
    FROM updated
)
SELECT EXISTS (SELECT 1 FROM updated) AS recorded;

-- Reaching the failure threshold moves a verified domain to failing and
-- queues one notice to each active superadmin in the same transaction, so the
-- notice is sent exactly once per failing period.
-- name: RecordOrgDomainAbsent :one
WITH updated AS (
    UPDATE vetchium.org_domains AS d
    SET consecutive_failures = d.consecutive_failures + 1,
        consecutive_inconclusive = 0,
        last_conclusive_at = now(),
        domain_state = CASE
            WHEN d.domain_state = 'verified'
                AND d.consecutive_failures + 1
                    >= sqlc.arg(failure_threshold)::integer
                THEN 'failing'::vetchium.org_domain_state
            ELSE d.domain_state
        END,
        failing_since = CASE
            WHEN d.domain_state = 'verified'
                AND d.consecutive_failures + 1
                    >= sqlc.arg(failure_threshold)::integer
                THEN now()
            ELSE d.failing_since
        END,
        next_check_at = sqlc.arg(next_check_at),
        updated_at = now()
    WHERE d.org_did = sqlc.arg(org_did)
      AND d.domain_state = sqlc.arg(expected_state)
      AND d.domain_state IN ('verified', 'failing')
    RETURNING d.org_did, d.domain, d.domain_state, d.consecutive_failures
), became_failing AS (
    SELECT org_did, domain
    FROM updated
    WHERE domain_state = 'failing'
      AND sqlc.arg(expected_state)::vetchium.org_domain_state = 'verified'
), notices AS (
    INSERT INTO vetchium.org_email_outbox (
        kind, recipient_email_address, preferred_language, payload_ciphertext
    )
    SELECT
        'domain-failing',
        u.email_address,
        u.preferred_language,
        sqlc.arg(notice_payload_ciphertext)
    FROM became_failing AS f
    JOIN vetchium.org_users AS u ON u.org_did = f.org_did
    WHERE u.org_user_state = 'active'
      AND EXISTS (
          SELECT 1 FROM vetchium.org_effective_permissions AS ep
          WHERE ep.org_user_id = u.org_user_id
            AND ep.permission = 'org:superadmin'
      )
    RETURNING org_email_outbox_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.domain.checked',
        'org_domain',
        org_did::text,
        sqlc.arg(actor_type),
        sqlc.arg(actor_id),
        sqlc.arg(source),
        jsonb_build_object(
            'domain', domain,
            'result', 'absent',
            'previous_state', sqlc.arg(expected_state)::text,
            'state', domain_state,
            'consecutive_failures', consecutive_failures,
            'notices_queued', (SELECT count(*) FROM notices)
        )
    FROM updated
)
SELECT
    EXISTS (SELECT 1 FROM updated) AS recorded,
    EXISTS (SELECT 1 FROM became_failing) AS became_failing;

-- name: RecordOrgDomainInconclusive :one
WITH updated AS (
    UPDATE vetchium.org_domains
    SET consecutive_inconclusive = consecutive_inconclusive + 1,
        next_check_at = sqlc.arg(next_check_at),
        updated_at = now()
    WHERE org_did = sqlc.arg(org_did)
      AND domain_state = sqlc.arg(expected_state)
      AND domain_state IN ('verified', 'failing', 'released')
    RETURNING org_did, domain, consecutive_inconclusive
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.domain.checked',
        'org_domain',
        org_did::text,
        sqlc.arg(actor_type),
        sqlc.arg(actor_id),
        sqlc.arg(source),
        jsonb_build_object(
            'domain', domain,
            'result', 'inconclusive',
            'state', sqlc.arg(expected_state)::text,
            'consecutive_inconclusive', consecutive_inconclusive
        )
    FROM updated
)
SELECT EXISTS (SELECT 1 FROM updated) AS recorded;

-- A released domain holds no claim, so a missing record only reschedules the
-- next attempt to restore it.
-- name: RecordReleasedOrgDomainAbsent :one
WITH updated AS (
    UPDATE vetchium.org_domains
    SET consecutive_inconclusive = 0,
        last_conclusive_at = now(),
        next_check_at = sqlc.arg(next_check_at),
        updated_at = now()
    WHERE org_did = sqlc.arg(org_did)
      AND domain_state = 'released'
    RETURNING org_did, domain
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.domain.checked',
        'org_domain',
        org_did::text,
        sqlc.arg(actor_type),
        sqlc.arg(actor_id),
        sqlc.arg(source),
        jsonb_build_object(
            'domain', domain, 'result', 'absent', 'state', 'released'
        )
    FROM updated
)
SELECT EXISTS (SELECT 1 FROM updated) AS recorded;

-- name: ListOrgDomainsPastGrace :many
SELECT org_did, domain, verification_token
FROM vetchium.org_domains
WHERE domain_state = 'failing'
  AND failing_since <= sqlc.arg(failing_before)
ORDER BY failing_since, org_did
LIMIT 25;

-- Suspends the Org locally before the global release is sent, so the Org is
-- never treated as owning a domain the directory may already have released.
-- name: BeginOrgDomainRelease :one
WITH updated AS (
    UPDATE vetchium.org_domains AS d
    SET domain_state = 'releasing',
        directory_command_id = sqlc.arg(directory_command_id),
        updated_at = now()
    WHERE d.org_did = sqlc.arg(org_did)
      AND d.domain_state = 'failing'
      AND d.failing_since <= sqlc.arg(failing_before)
    RETURNING d.org_did, d.domain, d.failing_since
), suspended AS (
    UPDATE vetchium.orgs AS o
    SET org_state = 'suspended',
        suspended_at = now(),
        updated_at = now()
    FROM updated
    WHERE o.org_did = updated.org_did
      AND o.org_state = 'active'
    RETURNING o.org_did
), notices AS (
    INSERT INTO vetchium.org_email_outbox (
        kind, recipient_email_address, preferred_language, payload_ciphertext
    )
    SELECT
        'org-suspended',
        u.email_address,
        u.preferred_language,
        sqlc.arg(notice_payload_ciphertext)
    FROM suspended AS s
    JOIN vetchium.org_users AS u ON u.org_did = s.org_did
    WHERE u.org_user_state = 'active'
      AND EXISTS (
          SELECT 1 FROM vetchium.org_effective_permissions AS ep
          WHERE ep.org_user_id = u.org_user_id
            AND ep.permission = 'org:superadmin'
      )
    RETURNING org_email_outbox_id
), domain_audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.domain.release-started',
        'org_domain',
        org_did::text,
        'worker',
        'verify-org-domains',
        'workers',
        jsonb_build_object(
            'domain', domain,
            'failing_since', failing_since,
            'directory_command_id', sqlc.arg(directory_command_id)::uuid
        )
    FROM updated
), org_audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.suspended',
        'org',
        org_did::text,
        'worker',
        'verify-org-domains',
        'workers',
        jsonb_build_object(
            'reason', 'domain_failing_past_grace',
            'notices_queued', (SELECT count(*) FROM notices)
        )
    FROM suspended
)
SELECT EXISTS (SELECT 1 FROM updated) AS started;

-- name: ListPendingOrgDomainCommands :many
SELECT org_did, domain, domain_state, directory_command_id
FROM vetchium.org_domains
WHERE domain_state IN ('releasing', 'reclaiming')
ORDER BY updated_at, org_did
LIMIT 25;

-- name: CompleteOrgDomainRelease :one
WITH updated AS (
    UPDATE vetchium.org_domains
    SET domain_state = 'released',
        directory_command_id = NULL,
        released_at = now(),
        failing_since = NULL,
        consecutive_failures = 0,
        consecutive_inconclusive = 0,
        next_check_at = sqlc.arg(next_check_at),
        updated_at = now()
    WHERE org_did = sqlc.arg(org_did)
      AND domain_state = 'releasing'
      AND directory_command_id = sqlc.arg(directory_command_id)
    RETURNING org_did, domain
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.domain.released',
        'org_domain',
        org_did::text,
        sqlc.arg(actor_type),
        sqlc.arg(actor_id),
        sqlc.arg(source),
        jsonb_build_object(
            'domain', domain,
            'directory_command_id', sqlc.arg(directory_command_id)::uuid
        )
    FROM updated
)
SELECT EXISTS (SELECT 1 FROM updated) AS completed;

-- name: BeginOrgDomainReclaim :one
WITH updated AS (
    UPDATE vetchium.org_domains
    SET domain_state = 'reclaiming',
        directory_command_id = sqlc.arg(directory_command_id),
        updated_at = now()
    WHERE org_did = sqlc.arg(org_did)
      AND domain_state = 'released'
    RETURNING org_did, domain
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.domain.reclaim-started',
        'org_domain',
        org_did::text,
        sqlc.arg(actor_type),
        sqlc.arg(actor_id),
        sqlc.arg(source),
        jsonb_build_object(
            'domain', domain,
            'directory_command_id', sqlc.arg(directory_command_id)::uuid
        )
    FROM updated
)
SELECT EXISTS (SELECT 1 FROM updated) AS started;

-- name: CompleteOrgDomainReclaim :one
WITH updated AS (
    UPDATE vetchium.org_domains AS d
    SET domain_state = 'verified',
        directory_command_id = NULL,
        released_at = NULL,
        consecutive_failures = 0,
        consecutive_inconclusive = 0,
        last_verified_at = now(),
        last_conclusive_at = now(),
        next_check_at = sqlc.arg(next_check_at),
        updated_at = now()
    WHERE d.org_did = sqlc.arg(org_did)
      AND d.domain_state = 'reclaiming'
      AND d.directory_command_id = sqlc.arg(directory_command_id)
    RETURNING d.org_did, d.domain
), reactivated AS (
    UPDATE vetchium.orgs AS o
    SET org_state = 'active',
        suspended_at = NULL,
        updated_at = now()
    FROM updated
    WHERE o.org_did = updated.org_did
      AND o.org_state = 'suspended'
    RETURNING o.org_did
), domain_audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.domain.reclaimed',
        'org_domain',
        org_did::text,
        sqlc.arg(actor_type),
        sqlc.arg(actor_id),
        sqlc.arg(source),
        jsonb_build_object('domain', domain)
    FROM updated
), org_audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.reactivated',
        'org',
        org_did::text,
        sqlc.arg(actor_type),
        sqlc.arg(actor_id),
        sqlc.arg(source),
        jsonb_build_object('reason', 'domain_reclaimed')
    FROM reactivated
)
SELECT EXISTS (SELECT 1 FROM updated) AS completed;

-- name: RejectOrgDomainReclaim :one
WITH updated AS (
    UPDATE vetchium.org_domains
    SET domain_state = 'released',
        directory_command_id = NULL,
        next_check_at = sqlc.arg(next_check_at),
        updated_at = now()
    WHERE org_did = sqlc.arg(org_did)
      AND domain_state = 'reclaiming'
      AND directory_command_id = sqlc.arg(directory_command_id)
    RETURNING org_did, domain
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.domain.reclaim-rejected',
        'org_domain',
        org_did::text,
        sqlc.arg(actor_type),
        sqlc.arg(actor_id),
        sqlc.arg(source),
        jsonb_build_object('domain', domain, 'reason', 'owned_by_another_org')
    FROM updated
)
SELECT EXISTS (SELECT 1 FROM updated) AS rejected;
