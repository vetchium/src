-- name: LockIdempotency :exec
SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0));

-- name: DeleteExpiredIdempotency :exec
DELETE FROM vetchium.idempotency_ledger
WHERE operation = $1
  AND binding_id = $2
  AND idempotency_key = $3
  AND expires_at <= now();

-- name: GetIdempotency :one
SELECT request_digest, response_status, response_ciphertext, expires_at
FROM vetchium.idempotency_ledger
WHERE operation = $1
  AND binding_id = $2
  AND idempotency_key = $3
  AND expires_at > now()
FOR UPDATE;

-- name: CreateIdempotency :exec
INSERT INTO vetchium.idempotency_ledger (
    operation,
    binding_id,
    idempotency_key,
    request_digest,
    expires_at
)
VALUES ($1, $2, $3, $4, $5);

-- name: CompleteIdempotency :exec
UPDATE vetchium.idempotency_ledger
SET response_status = $4,
    response_ciphertext = $5
WHERE operation = $1
  AND binding_id = $2
  AND idempotency_key = $3;

-- name: DeleteIdempotency :exec
DELETE FROM vetchium.idempotency_ledger
WHERE operation = $1
  AND binding_id = $2
  AND idempotency_key = $3;

-- name: PruneExpiredIdempotency :execrows
WITH candidates AS MATERIALIZED (
    SELECT operation, binding_id, idempotency_key
    FROM vetchium.idempotency_ledger AS candidate
    WHERE expires_at <= now()
    ORDER BY expires_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1000
)
DELETE FROM vetchium.idempotency_ledger AS ledger
USING candidates
WHERE ledger.operation = candidates.operation
  AND ledger.binding_id = candidates.binding_id
  AND ledger.idempotency_key = candidates.idempotency_key;
