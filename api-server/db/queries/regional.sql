-- name: Ping :one
SELECT 1 AS ping;

-- name: GetHubUserByEmail :one
SELECT * FROM hub_users WHERE email_address = $1;

-- name: GetHubUserByGlobalID :one
SELECT * FROM hub_users WHERE hub_user_global_id = $1;

-- name: GetHubUserByID :one
SELECT * FROM hub_users WHERE hub_user_id = $1;

-- name: CreateHubUser :one
INSERT INTO hub_users (hub_user_id, hub_user_global_id, email_address, password_hash)
VALUES (gen_random_uuid(), $1, $2, $3)
RETURNING *;

-- name: DeleteHubUser :exec
DELETE FROM hub_users WHERE hub_user_id = $1;

-- Hub TFA token queries

-- name: CreateHubTFAToken :exec
INSERT INTO hub_tfa_tokens (tfa_token, hub_user_id, tfa_code, expires_at)
VALUES ($1, $2, $3, $4);

-- name: GetHubTFAToken :one
SELECT * FROM hub_tfa_tokens WHERE tfa_token = $1 AND expires_at > NOW();

-- name: DeleteHubTFAToken :exec
DELETE FROM hub_tfa_tokens WHERE tfa_token = $1;

-- name: DeleteExpiredHubTFATokens :exec
DELETE FROM hub_tfa_tokens WHERE expires_at <= NOW();

-- Hub session queries

-- name: CreateHubSession :exec
INSERT INTO hub_sessions (session_token, hub_user_id, expires_at)
VALUES ($1, $2, $3);

-- name: GetHubSession :one
SELECT * FROM hub_sessions WHERE session_token = $1 AND expires_at > NOW();

-- name: DeleteHubSession :exec
DELETE FROM hub_sessions WHERE session_token = $1;

-- name: DeleteExpiredHubSessions :exec
DELETE FROM hub_sessions WHERE expires_at <= NOW();
