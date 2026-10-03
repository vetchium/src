-- Claims one Org whose subscription needs the worker: a renewal or scheduled
-- change at period end, or a retry or the deadline of an open invoice. The
-- claim holds the row until the transaction ends, so a request that locks it
-- waits and a second worker skips it. skipped_org_dids holds Orgs this run
-- already found unreadable.
-- name: ClaimDueOrgSubscription :one
SELECT o.org_did, d.domain::text AS domain
FROM vetchium.orgs AS o
JOIN vetchium.org_domains AS d ON d.org_did = o.org_did
LEFT JOIN vetchium.org_invoices AS oi
    ON oi.org_did = o.org_did AND oi.invoice_state = 'open'
WHERE o.org_state IN ('active', 'suspended')
  AND o.org_plan_oid <> 'org-free-tier'
  AND o.org_did <> ALL(sqlc.arg(skipped_org_dids)::uuid[])
  AND (
      (o.billing_state = 'current'
          AND o.subscription_period_end <= sqlc.arg(at))
      OR (o.billing_state = 'past_due'
          AND oi.org_invoice_id IS NOT NULL
          AND (oi.due_at <= sqlc.arg(at)
              OR oi.next_attempt_at <= sqlc.arg(at)))
  )
ORDER BY o.subscription_period_end, o.org_did
LIMIT 1
FOR NO KEY UPDATE OF o SKIP LOCKED;

-- The active users considered when an Org drops to Free.
-- name: ListOrgKeepCandidates :many
SELECT
    u.org_user_id,
    u.created_at,
    EXISTS (
        SELECT 1 FROM vetchium.org_effective_permissions AS e
        WHERE e.org_user_id = u.org_user_id
          AND e.permission = sqlc.arg(superadmin_permission)
    ) AS superadmin,
    EXISTS (
        SELECT 1 FROM vetchium.org_effective_permissions AS e
        WHERE e.org_user_id = u.org_user_id
          AND e.permission = sqlc.arg(billing_permission)
    ) AS manage_billing
FROM vetchium.org_users AS u
WHERE u.org_did = sqlc.arg(org_did)
  AND u.org_user_state = 'active';

-- The deadline's effect on people, in the transaction that voids the invoice
-- and drops the Org to Free, whichever of the worker or a request persisted
-- it: disable the users beyond the keep set with reason nonpayment and end
-- their sessions, cancel every pending invitation, and queue one email to each
-- disabled user. Disabled users keep their data and can be re-enabled one at a
-- time.
-- name: EnforceOrgDeadline :one
WITH targets AS (
    SELECT u.org_user_id, u.email_address, u.preferred_language
    FROM vetchium.org_users AS u
    WHERE u.org_did = sqlc.arg(org_did)
      AND u.org_user_id = ANY(sqlc.arg(disable_org_user_ids)::uuid[])
      AND u.org_user_state = 'active'
), disabled AS (
    UPDATE vetchium.org_users AS u
    SET org_user_state = 'disabled',
        disabled_reason = 'nonpayment',
        disabled_at = now(),
        disabled_by = NULL,
        updated_at = now()
    FROM targets AS t
    WHERE u.org_user_id = t.org_user_id
    RETURNING u.org_user_id, u.email_address, u.preferred_language
), sessions AS (
    DELETE FROM vetchium.org_sessions
    WHERE org_user_id IN (SELECT org_user_id FROM disabled)
), challenges AS (
    UPDATE vetchium.org_login_challenges
    SET active = false
    WHERE org_user_id IN (SELECT org_user_id FROM disabled) AND active
), resets AS (
    UPDATE vetchium.org_password_reset_tokens
    SET active = false
    WHERE org_user_id IN (SELECT org_user_id FROM disabled) AND active
), enrollments AS (
    UPDATE vetchium.org_totp_enrollments
    SET active = false
    WHERE org_user_id IN (SELECT org_user_id FROM disabled) AND active
), cancelled AS (
    UPDATE vetchium.org_user_invitations
    SET active = false
    WHERE org_did = sqlc.arg(org_did) AND active AND consumed_at IS NULL
    RETURNING email_address
), emails AS (
    INSERT INTO vetchium.org_email_outbox (
        kind, recipient_email_address, preferred_language, payload_ciphertext
    )
    SELECT
        'users-disabled-nonpayment',
        d.email_address,
        d.preferred_language,
        sqlc.arg(payload_ciphertext)
    FROM disabled AS d
    RETURNING org_email_outbox_id
), audit_users AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.users.disabled_nonpayment',
        'org',
        sqlc.arg(org_did)::text,
        sqlc.arg(actor_type)::text,
        sqlc.arg(actor_id)::text,
        sqlc.arg(source)::text,
        jsonb_build_object(
            'email_addresses', changed.email_addresses,
            'reason', 'nonpayment',
            'sessions_revoked', true
        )
    FROM (
        SELECT jsonb_agg(d.email_address ORDER BY d.email_address)
            AS email_addresses
        FROM disabled AS d
        HAVING count(*) > 0
    ) AS changed
), audit_invitations AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.invitations.cancelled_nonpayment',
        'org',
        sqlc.arg(org_did)::text,
        sqlc.arg(actor_type)::text,
        sqlc.arg(actor_id)::text,
        sqlc.arg(source)::text,
        jsonb_build_object('email_addresses', changed.email_addresses)
    FROM (
        SELECT jsonb_agg(c.email_address ORDER BY c.email_address)
            AS email_addresses
        FROM cancelled AS c
        HAVING count(*) > 0
    ) AS changed
)
-- The logo and Google sign-in go with the plan: SaveOrgSubscription moves the
-- Org to Free in the same transaction and clears both.
SELECT
    (SELECT count(*) FROM disabled)::bigint AS disabled_count,
    (SELECT count(*) FROM cancelled)::bigint AS cancelled_count,
    (SELECT count(*) FROM emails)::bigint AS emailed_count;

-- Queues one email to every active user holding billing_permission. Used for
-- a failed payment and for the move to Free, where the holders are the users
-- who remain active.
-- name: QueueOrgBillingHolderEmail :execrows
INSERT INTO vetchium.org_email_outbox (
    kind, recipient_email_address, preferred_language, payload_ciphertext
)
SELECT
    sqlc.arg(kind)::text,
    u.email_address,
    u.preferred_language,
    sqlc.arg(payload_ciphertext)
FROM vetchium.org_users AS u
WHERE u.org_did = sqlc.arg(org_did)
  AND u.org_user_state = 'active'
  AND EXISTS (
      SELECT 1 FROM vetchium.org_effective_permissions AS e
      WHERE e.org_user_id = u.org_user_id
        AND e.permission = sqlc.arg(billing_permission)
  );

-- Orgs whose payment deadline or scheduled plan change is within max_lead of
-- at. The caller decides which lead, if any, has opened; this only narrows
-- the scan. skipped_org_dids keeps a batch from re-selecting an Org this run
-- already decided.
-- name: ListOrgBillingNoticeCandidates :many
SELECT o.org_did, d.domain::text AS domain
FROM vetchium.orgs AS o
JOIN vetchium.org_domains AS d ON d.org_did = o.org_did
LEFT JOIN vetchium.org_invoices AS oi
    ON oi.org_did = o.org_did AND oi.invoice_state = 'open'
WHERE o.org_state IN ('active', 'suspended')
  AND o.org_plan_oid <> 'org-free-tier'
  AND o.org_did <> ALL(sqlc.arg(skipped_org_dids)::uuid[])
  AND (
      (o.billing_state = 'past_due'
          AND oi.due_at - sqlc.arg(max_lead_seconds)::double precision
              * interval '1 second' <= sqlc.arg(at)
          AND oi.due_at > sqlc.arg(at))
      OR (o.billing_state = 'current'
          AND o.scheduled_org_plan_oid IS NOT NULL
          AND o.subscription_period_end - sqlc.arg(max_lead_seconds)::double
              precision * interval '1 second' <= sqlc.arg(at)
          AND o.subscription_period_end > sqlc.arg(at))
  )
ORDER BY o.org_did
LIMIT sqlc.arg(batch_size);

-- Records that a warning was due, and queues it to the billing holders, only
-- the first time: a repeated or concurrent tick finds the row and queues
-- nothing.
-- name: RecordOrgBillingNotice :one
WITH recorded AS (
    INSERT INTO vetchium.org_billing_notices (
        org_did, notice_kind, target_at, lead_seconds
    )
    VALUES (
        sqlc.arg(org_did), sqlc.arg(notice_kind), sqlc.arg(target_at),
        sqlc.arg(lead_seconds)
    )
    ON CONFLICT (org_did, notice_kind, target_at, lead_seconds) DO NOTHING
    RETURNING org_did
), queued AS (
    INSERT INTO vetchium.org_email_outbox (
        kind, recipient_email_address, preferred_language, payload_ciphertext
    )
    SELECT
        sqlc.arg(email_kind)::text,
        u.email_address,
        u.preferred_language,
        sqlc.arg(payload_ciphertext)
    FROM vetchium.org_users AS u
    WHERE u.org_did = sqlc.arg(org_did)
      AND u.org_user_state = 'active'
      AND EXISTS (SELECT 1 FROM recorded)
      AND EXISTS (
          SELECT 1 FROM vetchium.org_effective_permissions AS e
          WHERE e.org_user_id = u.org_user_id
            AND e.permission = sqlc.arg(billing_permission)
      )
    RETURNING org_email_outbox_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.billing.notice_queued',
        'org',
        sqlc.arg(org_did)::text,
        'worker',
        'subscription-renewal',
        'workers',
        jsonb_build_object(
            'notice_kind', sqlc.arg(notice_kind)::text,
            'target_at', sqlc.arg(target_at)::timestamptz,
            'lead_seconds', sqlc.arg(lead_seconds)::bigint,
            'emails_queued', (SELECT count(*) FROM queued)
        )
    FROM recorded
)
SELECT
    EXISTS (SELECT 1 FROM recorded) AS recorded,
    (SELECT count(*) FROM queued)::bigint AS queued_count;
