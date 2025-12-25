-- name: Ping :one
SELECT 1 AS ping;

-- name: GetHubUserByHandle :one
SELECT * FROM hub_users WHERE handle = $1;

-- name: GetHubUserByGlobalID :one
SELECT * FROM hub_users WHERE hub_user_global_id = $1;

-- name: GetHubUserByEmailHash :one
SELECT * FROM hub_users WHERE email_address_hash = $1;

-- Admin user queries

-- name: GetAdminUserByEmail :one
SELECT * FROM admin_users WHERE email_address = $1;

-- name: GetAdminUserByID :one
SELECT * FROM admin_users WHERE admin_user_id = $1;

-- TFA token queries

-- name: CreateAdminTFAToken :exec
INSERT INTO admin_tfa_tokens (tfa_token, admin_user_id, tfa_code, expires_at)
VALUES ($1, $2, $3, $4);

-- name: GetAdminTFAToken :one
SELECT * FROM admin_tfa_tokens WHERE tfa_token = $1 AND expires_at > NOW();

-- name: DeleteAdminTFAToken :exec
DELETE FROM admin_tfa_tokens WHERE tfa_token = $1;

-- name: DeleteExpiredAdminTFATokens :exec
DELETE FROM admin_tfa_tokens WHERE expires_at <= NOW();

-- Session queries

-- name: CreateAdminSession :exec
INSERT INTO admin_sessions (session_token, admin_user_id, expires_at)
VALUES ($1, $2, $3);

-- name: GetAdminSession :one
SELECT * FROM admin_sessions WHERE session_token = $1 AND expires_at > NOW();

-- name: DeleteAdminSession :exec
DELETE FROM admin_sessions WHERE session_token = $1;

-- name: DeleteExpiredAdminSessions :exec
DELETE FROM admin_sessions WHERE expires_at <= NOW();

-- Supported languages queries

-- name: GetSupportedLanguages :many
SELECT language_code, language_name, native_name, is_default
FROM supported_languages
ORDER BY is_default DESC, language_name ASC;

-- name: GetDefaultLanguage :one
SELECT language_code FROM supported_languages WHERE is_default = TRUE;

-- name: GetSupportedLanguage :one
SELECT language_code, language_name, native_name, is_default
FROM supported_languages
WHERE language_code = $1;

-- Admin preferences queries

-- name: UpdateAdminPreferredLanguage :exec
UPDATE admin_users
SET preferred_language = $2
WHERE admin_user_id = $1;
