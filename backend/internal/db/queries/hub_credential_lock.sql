-- name: LockHubUserCredentialMutation :one
SELECT hub_user_did
FROM vetchium.hub_users
WHERE hub_user_did = $1
FOR UPDATE;

-- name: LockHubEmailCredentialMutation :one
SELECT hub_user_did
FROM vetchium.hub_users
WHERE email_address = $1
FOR UPDATE;
