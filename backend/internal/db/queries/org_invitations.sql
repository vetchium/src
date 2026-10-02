-- Takes the Org row lock that serializes every statement consuming a seat.
-- name: LockOrgSeatPolicy :one
SELECT o.org_plan_oid, d.domain::text AS domain
FROM vetchium.orgs AS o
JOIN vetchium.org_domains AS d ON d.org_did = o.org_did
WHERE o.org_did = sqlc.arg(org_did)
  AND o.org_state = 'active'
FOR UPDATE OF o;

-- One outcome per supplied address, in request order. When the new
-- invitations would exceed seat_limit (NULL means unlimited) none is created
-- and every would-be invitation is reported as 'limit-reached'.
-- name: InviteOrgUsers :many
WITH org AS (
    SELECT o.org_did, d.domain::text AS domain
    FROM vetchium.orgs AS o
    JOIN vetchium.org_domains AS d ON d.org_did = o.org_did
    WHERE o.org_did = sqlc.arg(org_did)
      AND d.domain_state <> 'released'
), inviter AS (
    SELECT u.preferred_language
    FROM vetchium.org_users AS u
    WHERE u.org_user_id = sqlc.arg(invited_by)
), input AS (
    SELECT
        e.email_address,
        n.invitation_id,
        h.token_hash,
        c.payload_ciphertext,
        e.position
    FROM unnest(sqlc.arg(email_addresses)::text[])
        WITH ORDINALITY AS e(email_address, position)
    JOIN unnest(sqlc.arg(invitation_ids)::uuid[])
        WITH ORDINALITY AS n(invitation_id, position)
        ON n.position = e.position
    JOIN unnest(sqlc.arg(token_hashes)::bytea[])
        WITH ORDINALITY AS h(token_hash, position)
        ON h.position = e.position
    JOIN unnest(sqlc.arg(payload_ciphertexts)::bytea[])
        WITH ORDINALITY AS c(payload_ciphertext, position)
        ON c.position = e.position
), classified AS (
    SELECT
        i.*,
        CASE
            WHEN EXISTS (
                SELECT 1
                FROM vetchium.org_users AS u
                WHERE u.org_did = org.org_did
                  AND u.email_address = i.email_address
            ) THEN 'already-member'
            WHEN EXISTS (
                SELECT 1
                FROM vetchium.org_user_invitations AS v
                WHERE v.org_did = org.org_did
                  AND v.email_address = i.email_address
                  AND v.active
                  AND v.consumed_at IS NULL
                  AND v.expires_at > now()
            ) THEN 'already-invited'
            WHEN substr(i.email_address, strpos(i.email_address, '@') + 1)
                <> org.domain THEN 'domain-mismatch'
            ELSE 'invited'
        END AS outcome
    FROM input AS i
    CROSS JOIN org
), seats AS (
    SELECT
        vetchium.org_seats_in_use(sqlc.arg(org_did)) AS in_use,
        (SELECT count(*) FROM classified WHERE outcome = 'invited') AS requested
), allowed AS (
    SELECT
        s.in_use,
        (sqlc.narg(seat_limit)::integer IS NULL
            OR s.in_use + s.requested <= sqlc.narg(seat_limit)::integer) AS ok
    FROM seats AS s
), upserted AS (
    INSERT INTO vetchium.org_user_invitations (
        org_invitation_id, org_did, email_address, token_hash, permissions,
        invited_by, expires_at
    )
    SELECT
        c.invitation_id,
        sqlc.arg(org_did),
        c.email_address,
        c.token_hash,
        sqlc.arg(permissions)::text[],
        sqlc.arg(invited_by),
        sqlc.arg(expires_at)
    FROM classified AS c
    CROSS JOIN allowed
    WHERE c.outcome = 'invited' AND allowed.ok
    ON CONFLICT (org_did, email_address) WHERE active DO UPDATE
    SET org_invitation_id = EXCLUDED.org_invitation_id,
        token_hash = EXCLUDED.token_hash,
        permissions = EXCLUDED.permissions,
        invited_by = EXCLUDED.invited_by,
        created_at = now(),
        expires_at = EXCLUDED.expires_at,
        consumed_at = NULL
    WHERE org_user_invitations.expires_at <= now()
    RETURNING org_invitation_id, email_address, expires_at
), outbox AS (
    INSERT INTO vetchium.org_email_outbox (
        kind, recipient_email_address, preferred_language, payload_ciphertext
    )
    SELECT
        'invitation',
        c.email_address,
        inviter.preferred_language,
        c.payload_ciphertext
    FROM classified AS c
    JOIN upserted AS u ON u.email_address = c.email_address
    CROSS JOIN inviter
    RETURNING org_email_outbox_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.invitations.created',
        'org',
        sqlc.arg(org_did)::text,
        'org_user',
        sqlc.arg(invited_by)::text,
        'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object(
            'email_addresses', created.email_addresses,
            'permissions', to_jsonb(sqlc.arg(permissions)::text[]),
            'emails_queued', (SELECT count(*) FROM outbox)
        )
    FROM (
        SELECT jsonb_agg(u.email_address ORDER BY u.email_address)
            AS email_addresses
        FROM upserted AS u
        HAVING count(*) > 0
    ) AS created
)
SELECT
    c.email_address::text AS email_address,
    CASE
        WHEN c.outcome = 'invited' AND NOT allowed.ok THEN 'limit-reached'
        ELSE c.outcome
    END::text AS outcome,
    u.expires_at AS expires_at,
    allowed.in_use::bigint AS seats_in_use
FROM classified AS c
CROSS JOIN allowed
LEFT JOIN upserted AS u ON u.email_address = c.email_address
ORDER BY c.position;

-- name: ListOrgInvitations :many
SELECT
    i.email_address,
    i.permissions,
    i.created_at,
    i.expires_at,
    inviter.email_address AS invited_by_email_address
FROM vetchium.org_user_invitations AS i
JOIN vetchium.org_users AS inviter ON inviter.org_user_id = i.invited_by
WHERE i.org_did = sqlc.arg(org_did)
  AND i.active
  AND i.consumed_at IS NULL
  AND (
      sqlc.narg(search)::text IS NULL
      OR strpos(i.email_address, sqlc.narg(search)::text) > 0
  )
  AND (
      sqlc.narg(after_email_address)::text IS NULL
      OR i.email_address > sqlc.narg(after_email_address)::text
  )
ORDER BY i.email_address
LIMIT sqlc.arg(page_limit);

-- Rotates the token and restarts the lifetime. An expired invitation holds no
-- seat, so resending it must fit the cap again.
-- name: ResendOrgInvitation :one
WITH existing AS (
    SELECT i.org_invitation_id, i.expires_at
    FROM vetchium.org_user_invitations AS i
    WHERE i.org_did = sqlc.arg(org_did)
      AND i.email_address = sqlc.arg(email_address)
      AND i.active
      AND i.consumed_at IS NULL
    FOR UPDATE
), allowed AS (
    SELECT
        vetchium.org_seats_in_use(sqlc.arg(org_did)) AS in_use,
        (sqlc.narg(seat_limit)::integer IS NULL
            OR vetchium.org_seats_in_use(sqlc.arg(org_did))
                + CASE WHEN e.expires_at > now() THEN 0 ELSE 1 END
                <= sqlc.narg(seat_limit)::integer) AS ok
    FROM existing AS e
), updated AS (
    UPDATE vetchium.org_user_invitations AS i
    SET token_hash = sqlc.arg(token_hash),
        created_at = now(),
        expires_at = sqlc.arg(expires_at)
    FROM existing AS e, allowed
    WHERE i.org_invitation_id = e.org_invitation_id AND allowed.ok
    RETURNING i.org_invitation_id, i.email_address, i.expires_at
), outbox AS (
    INSERT INTO vetchium.org_email_outbox (
        kind, recipient_email_address, preferred_language, payload_ciphertext
    )
    SELECT
        'invitation',
        u.email_address,
        actor.preferred_language,
        sqlc.arg(payload_ciphertext)
    FROM updated AS u
    JOIN vetchium.org_users AS actor
        ON actor.org_user_id = sqlc.arg(actor_org_user_id)
    RETURNING org_email_outbox_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.invitation.resent',
        'org_invitation',
        u.org_invitation_id::text,
        'org_user',
        sqlc.arg(actor_org_user_id)::text,
        'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object(
            'org_did', sqlc.arg(org_did)::text,
            'email_queued', EXISTS (SELECT 1 FROM outbox)
        )
    FROM updated AS u
)
SELECT
    CASE
        WHEN NOT EXISTS (SELECT 1 FROM existing) THEN 'not-found'
        WHEN NOT (SELECT ok FROM allowed) THEN 'limit-reached'
        ELSE 'ok'
    END::text AS result,
    (SELECT expires_at FROM updated) AS expires_at,
    COALESCE((SELECT in_use FROM allowed), 0)::bigint AS seats_in_use;

-- All or nothing: nothing is cancelled unless every address has a pending
-- invitation.
-- name: CancelOrgInvitations :one
WITH pending AS (
    SELECT i.org_invitation_id, i.email_address
    FROM vetchium.org_user_invitations AS i
    WHERE i.org_did = sqlc.arg(org_did)
      AND i.email_address = ANY(sqlc.arg(email_addresses)::text[])
      AND i.active
      AND i.consumed_at IS NULL
    FOR UPDATE
), found AS (
    SELECT count(*) = cardinality(sqlc.arg(email_addresses)::text[]) AS all_found
    FROM pending
), cancelled AS (
    UPDATE vetchium.org_user_invitations AS i
    SET active = false
    FROM pending AS p, found
    WHERE i.org_invitation_id = p.org_invitation_id AND found.all_found
    RETURNING i.email_address
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, actor_id,
        source, idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.invitations.cancelled',
        'org',
        sqlc.arg(org_did)::text,
        'org_user',
        sqlc.arg(actor_org_user_id)::text,
        'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object('email_addresses', cancelled.email_addresses)
    FROM (
        SELECT jsonb_agg(c.email_address ORDER BY c.email_address)
            AS email_addresses
        FROM cancelled AS c
        HAVING count(*) > 0
    ) AS cancelled
)
SELECT (SELECT all_found FROM found) AS all_found;

-- name: GetOrgInvitationDetails :one
SELECT
    i.email_address,
    d.domain::text AS domain,
    i.expires_at
FROM vetchium.org_user_invitations AS i
JOIN vetchium.orgs AS o ON o.org_did = i.org_did
JOIN vetchium.org_domains AS d ON d.org_did = o.org_did
WHERE i.token_hash = sqlc.arg(token_hash)
  AND i.active
  AND i.consumed_at IS NULL
  AND i.expires_at > now()
  AND o.org_state = 'active';

-- Locks the invitation's Org so acceptance is serialized with every other
-- seat-consuming statement, and returns the plan the cap derives from.
-- name: LockOrgForInvitation :one
SELECT o.org_did, o.org_plan_oid
FROM vetchium.org_user_invitations AS i
JOIN vetchium.orgs AS o ON o.org_did = i.org_did
WHERE i.token_hash = sqlc.arg(token_hash)
  AND i.active
  AND i.consumed_at IS NULL
  AND i.expires_at > now()
  AND o.org_state = 'active'
FOR UPDATE OF o;

-- name: AcceptOrgInvitation :one
WITH invitation AS (
    SELECT i.org_invitation_id, i.org_did, i.email_address, i.permissions
    FROM vetchium.org_user_invitations AS i
    JOIN vetchium.orgs AS o ON o.org_did = i.org_did
    WHERE i.token_hash = sqlc.arg(token_hash)
      AND i.org_did = sqlc.arg(org_did)
      AND i.active
      AND i.consumed_at IS NULL
      AND i.expires_at > now()
      AND o.org_state = 'active'
    FOR UPDATE OF i
), existing_user AS (
    SELECT 1
    FROM vetchium.org_users AS u
    WHERE u.org_did = sqlc.arg(org_did)
      AND u.email_address = (SELECT email_address FROM invitation)
), within_cap AS (
    -- The invitation already holds its seat, so converting it adds none; the
    -- check refuses only an Org that is already over its cap.
    SELECT (sqlc.narg(seat_limit)::integer IS NULL
        OR vetchium.org_seats_in_use(sqlc.arg(org_did))
            <= sqlc.narg(seat_limit)::integer) AS ok
), inserted_user AS (
    INSERT INTO vetchium.org_users (
        org_user_id, org_did, email_address, org_user_state, preferred_language
    )
    SELECT
        sqlc.arg(new_org_user_id),
        i.org_did,
        i.email_address,
        'active',
        sqlc.arg(preferred_language)
    FROM invitation AS i
    CROSS JOIN within_cap
    WHERE NOT EXISTS (SELECT 1 FROM existing_user) AND within_cap.ok
    RETURNING org_user_id, org_did, email_address
), inserted_password AS (
    INSERT INTO vetchium.org_user_passwords (org_user_id, password_hash)
    SELECT org_user_id, sqlc.arg(password_hash)
    FROM inserted_user
    RETURNING org_user_id
), granted AS (
    INSERT INTO vetchium.org_user_permissions (org_user_id, permission)
    SELECT u.org_user_id, c.permission
    FROM inserted_password AS u
    CROSS JOIN invitation AS i
    JOIN vetchium.org_permission_catalog AS c
        ON c.permission = ANY(i.permissions)
    RETURNING org_user_id
), consumed AS (
    UPDATE vetchium.org_user_invitations AS i
    SET consumed_at = now(), active = false
    FROM invitation AS inv
    WHERE i.org_invitation_id = inv.org_invitation_id
      AND EXISTS (SELECT 1 FROM inserted_password)
    RETURNING i.org_invitation_id
), audit AS (
    INSERT INTO vetchium.audit_events (
        tenant_id, action, entity_type, entity_id, actor_type, source,
        idempotency_key, payload
    )
    SELECT
        sqlc.arg(tenant_id),
        'org.invitation.accepted',
        'org_user',
        u.org_user_id::text,
        'anonymous',
        'orgs-api',
        sqlc.arg(idempotency_key),
        jsonb_build_object(
            'org_did', u.org_did::text,
            'permissions', to_jsonb(
                (SELECT permissions FROM invitation)
            )
        )
    FROM inserted_user AS u
    WHERE EXISTS (SELECT 1 FROM consumed)
)
SELECT
    CASE
        WHEN NOT EXISTS (SELECT 1 FROM invitation) THEN 'invalid-token'
        WHEN EXISTS (SELECT 1 FROM existing_user) THEN 'user-exists'
        WHEN NOT (SELECT ok FROM within_cap) THEN 'limit-reached'
        ELSE 'ok'
    END::text AS result,
    COALESCE((SELECT d.domain::text FROM vetchium.org_domains AS d
              WHERE d.org_did = sqlc.arg(org_did)), '')::text AS domain,
    COALESCE((SELECT email_address FROM invitation), '')::text
        AS email_address;
