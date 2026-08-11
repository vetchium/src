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
