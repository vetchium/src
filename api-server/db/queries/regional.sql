-- name: Ping :one
SELECT 1 AS ping;

-- name: GetHubUserByEmail :one
SELECT * FROM hub_users WHERE email_address = $1;

-- name: GetHubUserByGlobalID :one
SELECT * FROM hub_users WHERE hub_user_global_id = $1;
