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
INSERT INTO approved_domains (domain_name, created_by_admin_id, status)
VALUES ($1, $2, 'active')
RETURNING *;

-- name: ListApprovedDomainsActiveFirstPage :many
SELECT ad.domain_id, ad.domain_name, ad.created_by_admin_id,
       ad.created_at, ad.updated_at, ad.status,
       au.email_address AS admin_email
FROM approved_domains ad
JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.status = 'active'
ORDER BY ad.domain_name ASC
LIMIT $1;

-- name: ListApprovedDomainsActiveAfterCursor :many
SELECT ad.domain_id, ad.domain_name, ad.created_by_admin_id,
       ad.created_at, ad.updated_at, ad.status,
       au.email_address AS admin_email
FROM approved_domains ad
JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.status = 'active' AND ad.domain_name > $1
ORDER BY ad.domain_name ASC
LIMIT $2;

-- name: ListApprovedDomainsInactiveFirstPage :many
SELECT ad.domain_id, ad.domain_name, ad.created_by_admin_id,
       ad.created_at, ad.updated_at, ad.status,
       au.email_address AS admin_email
FROM approved_domains ad
JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.status = 'inactive'
ORDER BY ad.domain_name ASC
LIMIT $1;

-- name: ListApprovedDomainsInactiveAfterCursor :many
SELECT ad.domain_id, ad.domain_name, ad.created_by_admin_id,
       ad.created_at, ad.updated_at, ad.status,
       au.email_address AS admin_email
FROM approved_domains ad
JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.status = 'inactive' AND ad.domain_name > $1
ORDER BY ad.domain_name ASC
LIMIT $2;

-- name: ListApprovedDomainsAllFirstPage :many
SELECT ad.domain_id, ad.domain_name, ad.created_by_admin_id,
       ad.created_at, ad.updated_at, ad.status,
       au.email_address AS admin_email
FROM approved_domains ad
JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
ORDER BY ad.domain_name ASC
LIMIT $1;

-- name: ListApprovedDomainsAllAfterCursor :many
SELECT ad.domain_id, ad.domain_name, ad.created_by_admin_id,
       ad.created_at, ad.updated_at, ad.status,
       au.email_address AS admin_email
FROM approved_domains ad
JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.domain_name > $1
ORDER BY ad.domain_name ASC
LIMIT $2;

-- name: SearchApprovedDomainsActiveFirstPage :many
SELECT ad.domain_id, ad.domain_name, ad.created_by_admin_id,
       ad.created_at, ad.updated_at, ad.status,
       au.email_address AS admin_email,
       similarity(ad.domain_name, @search_term) AS sim_score
FROM approved_domains ad
JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.status = 'active' AND ad.domain_name % @search_term
ORDER BY sim_score DESC, ad.domain_name ASC
LIMIT @limit_count;

-- name: SearchApprovedDomainsActiveAfterCursor :many
SELECT ad.domain_id, ad.domain_name, ad.created_by_admin_id,
       ad.created_at, ad.updated_at, ad.status,
       au.email_address AS admin_email,
       similarity(ad.domain_name, @search_term) AS sim_score
FROM approved_domains ad
JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.status = 'active'
  AND ad.domain_name % @search_term
  AND (similarity(ad.domain_name, @search_term), ad.domain_name) < (@cursor_score::float4, @cursor_domain)
ORDER BY sim_score DESC, ad.domain_name ASC
LIMIT @limit_count;

-- name: SearchApprovedDomainsInactiveFirstPage :many
SELECT ad.domain_id, ad.domain_name, ad.created_by_admin_id,
       ad.created_at, ad.updated_at, ad.status,
       au.email_address AS admin_email,
       similarity(ad.domain_name, @search_term) AS sim_score
FROM approved_domains ad
JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.status = 'inactive' AND ad.domain_name % @search_term
ORDER BY sim_score DESC, ad.domain_name ASC
LIMIT @limit_count;

-- name: SearchApprovedDomainsInactiveAfterCursor :many
SELECT ad.domain_id, ad.domain_name, ad.created_by_admin_id,
       ad.created_at, ad.updated_at, ad.status,
       au.email_address AS admin_email,
       similarity(ad.domain_name, @search_term) AS sim_score
FROM approved_domains ad
JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.status = 'inactive'
  AND ad.domain_name % @search_term
  AND (similarity(ad.domain_name, @search_term), ad.domain_name) < (@cursor_score::float4, @cursor_domain)
ORDER BY sim_score DESC, ad.domain_name ASC
LIMIT @limit_count;

-- name: SearchApprovedDomainsAllFirstPage :many
SELECT ad.domain_id, ad.domain_name, ad.created_by_admin_id,
       ad.created_at, ad.updated_at, ad.status,
       au.email_address AS admin_email,
       similarity(ad.domain_name, @search_term) AS sim_score
FROM approved_domains ad
JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.domain_name % @search_term
ORDER BY sim_score DESC, ad.domain_name ASC
LIMIT @limit_count;

-- name: SearchApprovedDomainsAllAfterCursor :many
SELECT ad.domain_id, ad.domain_name, ad.created_by_admin_id,
       ad.created_at, ad.updated_at, ad.status,
       au.email_address AS admin_email,
       similarity(ad.domain_name, @search_term) AS sim_score
FROM approved_domains ad
JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.domain_name % @search_term
  AND (similarity(ad.domain_name, @search_term), ad.domain_name) < (@cursor_score::float4, @cursor_domain)
ORDER BY sim_score DESC, ad.domain_name ASC
LIMIT @limit_count;

-- name: GetApprovedDomainByID :one
SELECT * FROM approved_domains
WHERE domain_id = $1;

-- name: GetApprovedDomainByName :one
SELECT * FROM approved_domains
WHERE domain_name = $1;

-- name: GetApprovedDomainWithAdminByName :one
SELECT ad.domain_id, ad.domain_name, ad.created_by_admin_id,
       ad.created_at, ad.updated_at, ad.status,
       au.email_address AS admin_email
FROM approved_domains ad
JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.domain_name = $1;

-- name: DisableApprovedDomain :one
UPDATE approved_domains
SET status = 'inactive'
WHERE domain_id = $1 AND status = 'active'
RETURNING *;

-- name: EnableApprovedDomain :one
UPDATE approved_domains
SET status = 'active'
WHERE domain_id = $1 AND status = 'inactive'
RETURNING *;

-- name: CountApprovedDomainsActive :one
SELECT COUNT(*) FROM approved_domains WHERE status = 'active';

-- name: CountApprovedDomainsAll :one
SELECT COUNT(*) FROM approved_domains;

-- name: CreateAuditLog :one
INSERT INTO approved_domains_audit_log (
    admin_id, action, target_domain_id, target_domain_name,
    old_value, new_value, reason, ip_address, user_agent, request_id
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: GetAuditLogsByDomainIDFirstPage :many
SELECT al.*, au.email_address AS admin_email
FROM approved_domains_audit_log al
LEFT JOIN admin_users au ON al.admin_id = au.admin_user_id
WHERE al.target_domain_id = $1
ORDER BY al.created_at DESC
LIMIT $2;

-- name: GetAuditLogsByDomainIDAfterCursor :many
SELECT al.*, au.email_address AS admin_email
FROM approved_domains_audit_log al
LEFT JOIN admin_users au ON al.admin_id = au.admin_user_id
WHERE al.target_domain_id = $1 AND al.created_at < $2
ORDER BY al.created_at DESC
LIMIT $3;
