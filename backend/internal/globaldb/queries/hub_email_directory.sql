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

