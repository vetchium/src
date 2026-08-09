-- name: LockAdminUserCredentialMutation :one
SELECT admin_user_id
FROM vetchium.admin_users
WHERE admin_user_id = $1
FOR UPDATE;

-- name: LockAdminEmailCredentialMutation :one
SELECT admin_user_id
FROM vetchium.admin_users
WHERE email_address = $1
FOR UPDATE;

-- name: LockAdminIdempotency :exec
SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0));

-- name: DeleteExpiredAdminIdempotency :exec
DELETE FROM vetchium.admin_idempotency_ledger
WHERE operation = $1
  AND binding_id = $2
  AND idempotency_key = $3
  AND expires_at <= now();

-- name: GetAdminIdempotency :one
SELECT request_digest, response_status, response_ciphertext, expires_at
FROM vetchium.admin_idempotency_ledger
WHERE operation = $1
  AND binding_id = $2
  AND idempotency_key = $3
  AND expires_at > now()
FOR UPDATE;

-- name: CreateAdminIdempotency :exec
INSERT INTO vetchium.admin_idempotency_ledger (
    operation,
    binding_id,
    idempotency_key,
    request_digest,
    expires_at
)
VALUES ($1, $2, $3, $4, $5);

-- name: CompleteAdminIdempotency :exec
UPDATE vetchium.admin_idempotency_ledger
SET response_status = $4,
    response_ciphertext = $5
WHERE operation = $1
  AND binding_id = $2
  AND idempotency_key = $3;

-- name: DeleteAdminIdempotency :exec
DELETE FROM vetchium.admin_idempotency_ledger
WHERE operation = $1
  AND binding_id = $2
  AND idempotency_key = $3;
