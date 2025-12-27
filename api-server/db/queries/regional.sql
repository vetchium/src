-- name: Ping :one
SELECT 1 AS ping;

-- name: GetHubUserByEmail :one
SELECT * FROM hub_users WHERE email_address = $1;

-- name: GetHubUserByGlobalID :one
SELECT * FROM hub_users WHERE hub_user_global_id = $1;

-- name: CreateHubUser :one
INSERT INTO hub_users (hub_user_global_id, email_address, password_hash)
VALUES ($1, $2, $3)
RETURNING *;

-- name: DeleteHubUser :exec
DELETE FROM hub_users WHERE hub_user_id = $1;
