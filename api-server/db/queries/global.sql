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

-- Approved domains queries

-- name: CreateApprovedDomain :one
INSERT INTO approved_domains (domain_name, created_by_admin_id)
VALUES ($1, $2)
RETURNING *;

-- name: ListApprovedDomains :many
SELECT * FROM approved_domains
WHERE deleted_at IS NULL
ORDER BY domain_name ASC;

-- name: SearchApprovedDomains :many
SELECT * FROM approved_domains
WHERE deleted_at IS NULL
  AND domain_name % $1
ORDER BY similarity(domain_name, $1) DESC, domain_name ASC
LIMIT $2 OFFSET $3;

-- name: GetApprovedDomainByID :one
SELECT * FROM approved_domains
WHERE domain_id = $1;

-- name: GetApprovedDomainByName :one
SELECT * FROM approved_domains
WHERE domain_name = $1 AND deleted_at IS NULL;

-- name: SoftDeleteApprovedDomain :one
UPDATE approved_domains
SET deleted_at = NOW()
WHERE domain_id = $1 AND deleted_at IS NULL
RETURNING *;

-- name: CountApprovedDomains :one
SELECT COUNT(*) FROM approved_domains WHERE deleted_at IS NULL;

-- name: CreateAuditLog :one
INSERT INTO approved_domains_audit_log (
    admin_id, action, target_domain_id, target_domain_name,
    old_value, new_value, ip_address, user_agent, request_id
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: GetAuditLogsByDomainID :many
SELECT * FROM approved_domains_audit_log
WHERE target_domain_id = $1
ORDER BY created_at DESC;

-- name: GetAuditLogs :many
SELECT * FROM approved_domains_audit_log
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;
