-- name: ResolveHubAccountEmail :one
SELECT claim.hub_user_did, principal.home_tenant_id
FROM vetchium.hub_account_email_claims AS claim
INNER JOIN vetchium.hub_principals AS principal
    ON principal.hub_user_did = claim.hub_user_did
WHERE claim.email_digest = sqlc.arg(email_digest)
  AND claim.state IN ('provisioning', 'active');

-- name: LockHubAccountEmailChangeReservation :one
SELECT change_id, hub_user_did, email_digest, state, not_after
FROM vetchium.hub_account_email_change_reservations
WHERE change_id = sqlc.arg(change_id)
FOR UPDATE;

-- Cancels any other reservation this user still has open and deletes its
-- pending_change claim before inserting the new one, so the partial unique
-- index on one pending_change claim per user is never violated (GU-DIR-004).
-- The caller has already locked (or confirmed absent) the row for change_id.
-- name: ReserveHubAccountEmailChange :one
WITH stale_reservation AS (
    UPDATE vetchium.hub_account_email_change_reservations AS reservation
    SET state = 'cancelled', updated_at = now()
    WHERE reservation.hub_user_did = sqlc.arg(hub_user_did)
      AND reservation.state = 'reserved'
      AND reservation.change_id <> sqlc.arg(change_id)
    RETURNING reservation.change_id
), stale_claim AS (
    DELETE FROM vetchium.hub_account_email_claims AS claim
    USING stale_reservation
    WHERE claim.hub_user_did = sqlc.arg(hub_user_did)
      AND claim.state = 'pending_change'
      AND claim.change_id = stale_reservation.change_id
    RETURNING claim.email_digest
), inserted_reservation AS (
    INSERT INTO vetchium.hub_account_email_change_reservations (
        change_id, hub_user_did, email_digest, state, not_after
    )
    SELECT sqlc.arg(change_id), sqlc.arg(hub_user_did),
        sqlc.arg(email_digest), 'reserved', sqlc.arg(not_after)
    RETURNING change_id
), inserted_claim AS (
    INSERT INTO vetchium.hub_account_email_claims (
        email_digest, hub_user_did, state, command_id, change_id
    )
    SELECT sqlc.arg(email_digest), sqlc.arg(hub_user_did), 'pending_change',
        sqlc.arg(command_id), inserted_reservation.change_id
    FROM inserted_reservation
    -- Forces stale_claim to run first, freeing this user's one
    -- pending_change slot before this insert claims it.
    LEFT JOIN stale_claim ON TRUE
    RETURNING email_digest
)
SELECT
    (SELECT change_id FROM inserted_reservation) AS change_id,
    (SELECT count(*) FROM inserted_claim) AS inserted_claim_count;

-- Requires the caller to have already locked the reservation as 'reserved'.
-- Deletes the user's current active claim (if any) before promoting the
-- pending_change claim, so the one-current-claim index is never violated,
-- and marks the reservation finalized in the same statement (GU-DIR-005).
-- name: FinalizeHubAccountEmailChange :one
WITH released_active AS (
    DELETE FROM vetchium.hub_account_email_claims AS claim
    WHERE claim.hub_user_did = sqlc.arg(hub_user_did)
      AND claim.state = 'active'
    RETURNING claim.hub_user_did
), promoted_claim AS (
    UPDATE vetchium.hub_account_email_claims AS claim
    SET state = 'active', change_id = NULL, updated_at = now()
    FROM (SELECT 1 AS marker) AS base
    LEFT JOIN released_active ON TRUE
    WHERE claim.change_id = sqlc.arg(change_id)
      AND claim.state = 'pending_change'
    RETURNING claim.hub_user_did, claim.email_digest
)
UPDATE vetchium.hub_account_email_change_reservations AS reservation
SET state = 'finalized', updated_at = now()
FROM promoted_claim
WHERE reservation.change_id = sqlc.arg(change_id)
RETURNING promoted_claim.hub_user_did, promoted_claim.email_digest;

-- Requires the caller to have already locked the reservation as 'reserved'.
-- name: AbandonReservedHubAccountEmailChange :one
WITH cancelled_reservation AS (
    UPDATE vetchium.hub_account_email_change_reservations AS reservation
    SET state = 'cancelled', updated_at = now()
    WHERE reservation.change_id = sqlc.arg(change_id)
      AND reservation.state = 'reserved'
    RETURNING reservation.change_id AS change_id,
        reservation.hub_user_did AS hub_user_did
), deleted_claim AS (
    DELETE FROM vetchium.hub_account_email_claims AS claim
    USING cancelled_reservation
    WHERE claim.change_id = cancelled_reservation.change_id
      AND claim.state = 'pending_change'
    RETURNING claim.email_digest AS email_digest
)
SELECT
    (SELECT change_id FROM cancelled_reservation) AS change_id,
    (SELECT email_digest FROM deleted_claim) AS email_digest;

-- The change id alone fences a reserve that has not arrived yet: a later
-- reserve for the same change id finds this tombstone and is rejected
-- (GU-DIR-006).
-- name: InsertAbandonedHubAccountEmailChangeTombstone :exec
INSERT INTO vetchium.hub_account_email_change_reservations (
    change_id, hub_user_did, email_digest, state, not_after
) VALUES (
    sqlc.arg(change_id), sqlc.arg(hub_user_did), NULL, 'cancelled',
    sqlc.arg(not_after)
);

-- name: PruneTerminalHubAccountEmailChangeReservations :execrows
DELETE FROM vetchium.hub_account_email_change_reservations
WHERE state IN ('cancelled', 'finalized')
  AND not_after < sqlc.arg(cutoff);

-- Absent: the row does not exist yet, so nothing to lock; the caller inserts
-- it directly (InsertHubProfessionalEmailClaimIfAbsent). Otherwise, the
-- caller locks the existing row with this query and then always applies
-- TransferHubProfessionalEmailClaim, whether the previous holder was this
-- same user, another user, or nobody (released) -- newest proof always wins
-- and always bumps the revision (GU-DIR-007).
-- name: LockHubProfessionalEmailClaim :one
SELECT claim.hub_user_did, claim.claim_revision, principal.home_tenant_id
FROM vetchium.hub_professional_email_claims AS claim
LEFT JOIN vetchium.hub_principals AS principal
    ON principal.hub_user_did = claim.hub_user_did
WHERE claim.email_digest = sqlc.arg(email_digest)
FOR UPDATE OF claim;

-- Safe under concurrency without a savepoint-based retry loop: a racing
-- first claim of the same never-before-seen digest blocks here until the
-- winner commits, then finds the row already present and takes the
-- LockHubProfessionalEmailClaim + TransferHubProfessionalEmailClaim path.
-- name: InsertHubProfessionalEmailClaimIfAbsent :one
INSERT INTO vetchium.hub_professional_email_claims (
    email_digest, hub_user_did, claim_revision, claimed_at
) VALUES (
    sqlc.arg(email_digest), sqlc.arg(hub_user_did), 1, now()
)
ON CONFLICT (email_digest) DO NOTHING
RETURNING claim_revision;

-- The caller must already hold the row lock from LockHubProfessionalEmailClaim
-- in this transaction.
-- name: TransferHubProfessionalEmailClaim :one
UPDATE vetchium.hub_professional_email_claims
SET hub_user_did = sqlc.arg(hub_user_did),
    claim_revision = claim_revision + 1,
    claimed_at = now()
WHERE email_digest = sqlc.arg(email_digest)
RETURNING claim_revision;

-- A stale revision, or a digest already released by someone else's newer
-- proof, is a safe no-op (GU-DIR-008).
-- name: ReleaseHubProfessionalEmailClaim :execrows
UPDATE vetchium.hub_professional_email_claims
SET hub_user_did = NULL
WHERE email_digest = sqlc.arg(email_digest)
  AND hub_user_did = sqlc.arg(hub_user_did)
  AND claim_revision = sqlc.arg(claim_revision);

-- The row lock is held until commit, so sequence N+1 cannot be issued, let
-- alone become visible, until N has committed or rolled back (GU-GDB-003).
-- name: EnsureHubProfessionalEmailFeedCursor :exec
INSERT INTO vetchium.hub_professional_email_feed_cursors (tenant_id)
VALUES (sqlc.arg(tenant_id))
ON CONFLICT DO NOTHING;

-- name: NextHubProfessionalEmailSupersessionSeq :one
UPDATE vetchium.hub_professional_email_feed_cursors
SET last_issued_seq = last_issued_seq + 1
WHERE tenant_id = sqlc.arg(tenant_id)
RETURNING last_issued_seq;

-- name: InsertHubProfessionalEmailSupersession :exec
INSERT INTO vetchium.hub_professional_email_supersessions (
    previous_home_tenant_id, supersession_seq, email_digest,
    previous_hub_user_did, superseded_by_revision
) VALUES (
    sqlc.arg(previous_home_tenant_id), sqlc.arg(supersession_seq),
    sqlc.arg(email_digest), sqlc.arg(previous_hub_user_did),
    sqlc.arg(superseded_by_revision)
);

-- name: LockHubProfessionalEmailFeedCursor :one
INSERT INTO vetchium.hub_professional_email_feed_cursors (tenant_id)
VALUES (sqlc.arg(tenant_id))
ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
RETURNING tenant_id, last_issued_seq, acknowledged_seq;

-- name: AcknowledgeHubProfessionalEmailSupersessions :exec
UPDATE vetchium.hub_professional_email_feed_cursors
SET acknowledged_seq = sqlc.arg(acknowledged_seq)
WHERE tenant_id = sqlc.arg(tenant_id);

-- name: DeleteAcknowledgedHubProfessionalEmailSupersessions :execrows
DELETE FROM vetchium.hub_professional_email_supersessions
WHERE previous_home_tenant_id = sqlc.arg(tenant_id)
  AND supersession_seq <= sqlc.arg(acknowledged_seq);

-- name: ListPendingHubProfessionalEmailSupersessions :many
SELECT supersession_seq, email_digest, previous_hub_user_did,
    superseded_by_revision, created_at
FROM vetchium.hub_professional_email_supersessions
WHERE previous_home_tenant_id = sqlc.arg(tenant_id)
  AND supersession_seq > sqlc.arg(acknowledged_seq)
ORDER BY supersession_seq
LIMIT sqlc.arg(row_limit);

-- name: OldestPendingHubProfessionalEmailSupersession :one
SELECT min(created_at)::timestamptz AS oldest_pending_created_at
FROM vetchium.hub_professional_email_supersessions
WHERE previous_home_tenant_id = sqlc.arg(tenant_id);

-- Rejects the whole batch (empty result absent, non-zero count present) when
-- any requested DID is not homed at the caller, so the holdings check never
-- answers about a DID it does not own (GU-DIR-011).
-- name: CountHubPrincipalsNotHomedAtTenant :one
SELECT count(*)
FROM unnest(sqlc.arg(hub_user_dids)::uuid[]) AS requested (hub_user_did)
WHERE NOT EXISTS (
    SELECT 1 FROM vetchium.hub_principals AS principal
    WHERE principal.hub_user_did = requested.hub_user_did
      AND principal.home_tenant_id = sqlc.arg(caller_tenant_id)
);

-- claim.hub_user_did and claim.claim_revision are both null when no claim
-- row exists at all; claim.hub_user_did alone is null when the row is
-- released. The caller derives held_by_requested_user and treats
-- claim_revision as absent unless claim.hub_user_did is non-null, since a
-- released row still carries its last revision in this raw result
-- (GU-DIR-011).
-- name: CheckHubProfessionalEmailHoldings :many
SELECT
    requested_did.hub_user_did::uuid AS hub_user_did,
    requested_digest.email_digest::bytea AS email_digest,
    claim.hub_user_did AS holder_hub_user_did,
    claim.claim_revision AS claim_revision
FROM unnest(sqlc.arg(hub_user_dids)::uuid[]) WITH ORDINALITY
        AS requested_did (hub_user_did, ord)
INNER JOIN unnest(sqlc.arg(email_digests)::bytea[]) WITH ORDINALITY
        AS requested_digest (email_digest, ord)
    ON requested_digest.ord = requested_did.ord
LEFT JOIN vetchium.hub_professional_email_claims AS claim
    ON claim.email_digest = requested_digest.email_digest;
