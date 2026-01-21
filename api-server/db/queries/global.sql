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
WHERE ad.status = 'active' AND ad.domain_name ILIKE '%' || @search_term || '%'
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
  AND ad.domain_name ILIKE '%' || @search_term || '%'
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
WHERE ad.status = 'inactive' AND ad.domain_name ILIKE '%' || @search_term || '%'
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
  AND ad.domain_name ILIKE '%' || @search_term || '%'
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
WHERE ad.domain_name ILIKE '%' || @search_term || '%'
ORDER BY sim_score DESC, ad.domain_name ASC
LIMIT @limit_count;

-- name: SearchApprovedDomainsAllAfterCursor :many
SELECT ad.domain_id, ad.domain_name, ad.created_by_admin_id,
       ad.created_at, ad.updated_at, ad.status,
       au.email_address AS admin_email,
       similarity(ad.domain_name, @search_term) AS sim_score
FROM approved_domains ad
JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.domain_name ILIKE '%' || @search_term || '%'
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

-- Hub signup tokens

-- name: CreateHubSignupToken :exec
INSERT INTO hub_signup_tokens (signup_token, email_address, email_address_hash, hashing_algorithm, expires_at)
VALUES ($1, $2, $3, $4, $5);

-- name: GetHubSignupToken :one
SELECT * FROM hub_signup_tokens WHERE signup_token = $1 AND expires_at > NOW();

-- name: MarkHubSignupTokenConsumed :exec
UPDATE hub_signup_tokens SET consumed_at = NOW() WHERE signup_token = $1;

-- name: DeleteExpiredHubSignupTokens :exec
DELETE FROM hub_signup_tokens WHERE expires_at <= NOW();

-- name: DeleteHubSignupToken :exec
DELETE FROM hub_signup_tokens WHERE signup_token = $1;

-- name: GetActiveHubSignupTokenByEmailHash :one
SELECT * FROM hub_signup_tokens
WHERE email_address_hash = $1 AND expires_at > NOW()
ORDER BY created_at DESC
LIMIT 1;

-- Hub user creation

-- name: CreateHubUser :one
INSERT INTO hub_users (
    hub_user_global_id, handle, email_address_hash, hashing_algorithm,
    status, preferred_language, home_region, resident_country_code
)
VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: CreateHubUserDisplayName :exec
INSERT INTO hub_user_display_names (hub_user_global_id, language_code, display_name, is_preferred)
VALUES ($1, $2, $3, $4);

-- name: GetHubUserDisplayNames :many
SELECT * FROM hub_user_display_names WHERE hub_user_global_id = $1
ORDER BY is_preferred DESC, language_code ASC;

-- name: GetHubUserPreferredDisplayName :one
SELECT display_name FROM hub_user_display_names
WHERE hub_user_global_id = $1 AND is_preferred = TRUE;

-- name: DeleteHubUser :exec
DELETE FROM hub_users WHERE hub_user_global_id = $1;

-- Regions

-- name: GetActiveRegions :many
SELECT * FROM available_regions WHERE is_active = TRUE ORDER BY region_name ASC;

-- name: GetRegionByCode :one
SELECT * FROM available_regions WHERE region_code = $1;

-- Domain validation (uses existing approved_domains table)

-- name: GetActiveDomainByName :one
SELECT * FROM approved_domains WHERE domain_name = $1 AND status = 'active';

-- Hub preferences queries

-- name: UpdateHubUserPreferredLanguage :exec
UPDATE hub_users
SET preferred_language = $2
WHERE hub_user_global_id = $1;

-- ============================================
-- Org User Queries
-- ============================================

-- name: GetOrgUserByEmailHash :one
-- Note: This returns ONE user but may fail if email exists for multiple employers.
-- Prefer GetOrgUserByEmailHashAndEmployer for login flows.
SELECT * FROM org_users WHERE email_address_hash = $1;

-- name: GetOrgUserByEmailHashAndEmployer :one
-- Composite lookup for login flow - email + employer uniquely identifies user
SELECT * FROM org_users
WHERE email_address_hash = $1 AND employer_id = $2;

-- name: GetOrgUsersByEmailHash :many
-- Returns all org_users for a given email hash (for multi-employer scenarios)
SELECT ou.*, e.employer_name
FROM org_users ou
JOIN employers e ON ou.employer_id = e.employer_id
WHERE ou.email_address_hash = $1 AND ou.status = 'active'
ORDER BY e.employer_name;

-- name: GetOrgUserByID :one
SELECT * FROM org_users WHERE org_user_id = $1;

-- name: CreateOrgUser :one
INSERT INTO org_users (
    email_address_hash, hashing_algorithm, employer_id,
    full_name, is_admin,
    status, preferred_language, home_region
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: DeleteOrgUser :exec
DELETE FROM org_users WHERE org_user_id = $1;

-- name: UpdateOrgUserPreferredLanguage :exec
UPDATE org_users
SET preferred_language = $2
WHERE org_user_id = $1;

-- name: UpdateOrgUserFullName :exec
UPDATE org_users
SET full_name = $2
WHERE org_user_id = $1;

-- name: UpdateOrgUserStatus :exec
UPDATE org_users
SET status = $2
WHERE org_user_id = $1;

-- ============================================
-- Org Signup Token Queries (DNS-based domain verification)
-- ============================================

-- name: CreateOrgSignupToken :exec
INSERT INTO org_signup_tokens (signup_token, email_token, email_address, email_address_hash, hashing_algorithm, expires_at, home_region, domain)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: GetOrgSignupToken :one
SELECT * FROM org_signup_tokens WHERE signup_token = $1 AND expires_at > NOW();

-- name: GetOrgSignupTokenByEmailToken :one
-- Get pending signup by email token (for complete-signup flow - proves email access)
SELECT * FROM org_signup_tokens
WHERE email_token = $1 AND expires_at > NOW() AND consumed_at IS NULL;

-- name: GetOrgSignupTokenByEmail :one
-- Get pending signup by email address (for resend email flow)
SELECT * FROM org_signup_tokens
WHERE email_address = $1 AND expires_at > NOW() AND consumed_at IS NULL
ORDER BY created_at DESC
LIMIT 1;

-- name: GetPendingSignupByDomain :one
-- Check if a domain has a pending (non-expired, non-consumed) signup
SELECT * FROM org_signup_tokens
WHERE domain = $1 AND expires_at > NOW() AND consumed_at IS NULL
LIMIT 1;

-- name: MarkOrgSignupTokenConsumed :exec
UPDATE org_signup_tokens SET consumed_at = NOW() WHERE signup_token = $1;

-- name: DeleteExpiredOrgSignupTokens :exec
DELETE FROM org_signup_tokens WHERE expires_at <= NOW();

-- name: DeleteOrgSignupToken :exec
DELETE FROM org_signup_tokens WHERE signup_token = $1;

-- name: GetActiveOrgSignupTokenByEmailHash :one
SELECT * FROM org_signup_tokens
WHERE email_address_hash = $1 AND expires_at > NOW()
ORDER BY created_at DESC
LIMIT 1;

-- ============================================
-- Employer Queries
-- ============================================

-- name: CreateEmployer :one
INSERT INTO employers (employer_name, region)
VALUES ($1, $2)
RETURNING *;

-- name: GetEmployerByID :one
SELECT * FROM employers WHERE employer_id = $1;

-- name: GetEmployerByDomain :one
-- Find employer by verified domain name (for login flow)
SELECT e.* FROM employers e
JOIN global_employer_domains ged ON e.employer_id = ged.employer_id
WHERE ged.domain = $1 AND ged.status = 'VERIFIED';

-- name: DeleteEmployer :exec
DELETE FROM employers WHERE employer_id = $1;

-- ============================================
-- Global Employer Domain Queries
-- ============================================

-- name: CreateGlobalEmployerDomain :exec
INSERT INTO global_employer_domains (domain, region, employer_id, status)
VALUES ($1, $2, $3, $4);

-- name: GetGlobalEmployerDomain :one
SELECT * FROM global_employer_domains WHERE domain = $1;

-- name: UpdateGlobalEmployerDomainStatus :exec
UPDATE global_employer_domains
SET status = $2
WHERE domain = $1;

-- name: DeleteGlobalEmployerDomain :exec
DELETE FROM global_employer_domains WHERE domain = $1;

-- name: GetGlobalEmployerDomainsByEmployer :many
SELECT * FROM global_employer_domains
WHERE employer_id = $1
ORDER BY domain ASC;

-- ============================================
-- Agency User Queries
-- ============================================

-- name: GetAgencyUserByEmailHash :one
-- Note: This returns ONE user but may fail if email exists for multiple agencies.
-- Prefer GetAgencyUserByEmailHashAndAgency for login flows.
SELECT * FROM agency_users WHERE email_address_hash = $1;

-- name: GetAgencyUserByEmailHashAndAgency :one
-- Composite lookup for login flow - email + agency uniquely identifies user
SELECT * FROM agency_users
WHERE email_address_hash = $1 AND agency_id = $2;

-- name: GetAgencyUsersByEmailHash :many
-- Returns all agency_users for a given email hash (for multi-agency scenarios)
SELECT au.*, a.agency_name
FROM agency_users au
JOIN agencies a ON au.agency_id = a.agency_id
WHERE au.email_address_hash = $1 AND au.status = 'active'
ORDER BY a.agency_name;

-- name: GetAgencyUserByID :one
SELECT * FROM agency_users WHERE agency_user_id = $1;

-- name: CreateAgencyUser :one
INSERT INTO agency_users (
    email_address_hash, hashing_algorithm, agency_id,
    full_name, is_admin,
    status, preferred_language, home_region
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: UpdateAgencyUserStatus :exec
UPDATE agency_users
SET status = $2
WHERE agency_user_id = $1;

-- name: UpdateAgencyUserFullName :exec
UPDATE agency_users
SET full_name = $2
WHERE agency_user_id = $1;

-- name: DeleteAgencyUser :exec
DELETE FROM agency_users WHERE agency_user_id = $1;

-- name: UpdateAgencyUserPreferredLanguage :exec
UPDATE agency_users
SET preferred_language = $2
WHERE agency_user_id = $1;

-- ============================================
-- Agency Signup Token Queries (DNS-based domain verification)
-- ============================================

-- name: CreateAgencySignupToken :exec
INSERT INTO agency_signup_tokens (signup_token, email_token, email_address, email_address_hash, hashing_algorithm, expires_at, home_region, domain)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: GetAgencySignupToken :one
SELECT * FROM agency_signup_tokens WHERE signup_token = $1 AND expires_at > NOW();

-- name: GetAgencySignupTokenByEmailToken :one
-- Get pending signup by email token (for complete-signup flow - proves email access)
SELECT * FROM agency_signup_tokens
WHERE email_token = $1 AND expires_at > NOW() AND consumed_at IS NULL;

-- name: GetAgencySignupTokenByEmail :one
-- Get pending signup by email address (for resend email flow)
SELECT * FROM agency_signup_tokens
WHERE email_address = $1 AND expires_at > NOW() AND consumed_at IS NULL
ORDER BY created_at DESC
LIMIT 1;

-- name: GetPendingAgencySignupByDomain :one
-- Check if a domain has a pending (non-expired, non-consumed) signup
SELECT * FROM agency_signup_tokens
WHERE domain = $1 AND expires_at > NOW() AND consumed_at IS NULL
LIMIT 1;

-- name: MarkAgencySignupTokenConsumed :exec
UPDATE agency_signup_tokens SET consumed_at = NOW() WHERE signup_token = $1;

-- name: DeleteExpiredAgencySignupTokens :exec
DELETE FROM agency_signup_tokens WHERE expires_at <= NOW();

-- name: DeleteAgencySignupToken :exec
DELETE FROM agency_signup_tokens WHERE signup_token = $1;

-- name: GetActiveAgencySignupTokenByEmailHash :one
SELECT * FROM agency_signup_tokens
WHERE email_address_hash = $1 AND expires_at > NOW()
ORDER BY created_at DESC
LIMIT 1;

-- ============================================
-- Agency Queries
-- ============================================

-- name: CreateAgency :one
INSERT INTO agencies (agency_name, region)
VALUES ($1, $2)
RETURNING *;

-- name: GetAgencyByID :one
SELECT * FROM agencies WHERE agency_id = $1;

-- name: GetAgencyByDomain :one
-- Find agency by verified domain name (for login flow)
SELECT a.* FROM agencies a
JOIN global_agency_domains gad ON a.agency_id = gad.agency_id
WHERE gad.domain = $1 AND gad.status = 'VERIFIED';

-- name: DeleteAgency :exec
DELETE FROM agencies WHERE agency_id = $1;

-- ============================================
-- Global Agency Domain Queries
-- ============================================

-- name: CreateGlobalAgencyDomain :exec
INSERT INTO global_agency_domains (domain, region, agency_id, status)
VALUES ($1, $2, $3, $4);

-- name: GetGlobalAgencyDomain :one
SELECT * FROM global_agency_domains WHERE domain = $1;

-- name: UpdateGlobalAgencyDomainStatus :exec
UPDATE global_agency_domains
SET status = $2
WHERE domain = $1;

-- name: DeleteGlobalAgencyDomain :exec
DELETE FROM global_agency_domains WHERE domain = $1;

-- name: GetGlobalAgencyDomainsByAgency :many
SELECT * FROM global_agency_domains
WHERE agency_id = $1
ORDER BY domain ASC;

-- ============================================
-- Hub User Email Update Queries
-- ============================================

-- name: UpdateHubUserEmailHash :exec
UPDATE hub_users SET email_address_hash = $2 WHERE hub_user_global_id = $1;

-- ============================================
-- Admin Invitation Queries
-- ============================================

-- name: CreateAdminInvitationToken :exec
INSERT INTO admin_invitation_tokens (invitation_token, admin_user_id, expires_at)
VALUES ($1, $2, $3);

-- name: GetAdminInvitationToken :one
SELECT * FROM admin_invitation_tokens WHERE invitation_token = $1 AND expires_at > NOW();

-- name: DeleteAdminInvitationToken :exec
DELETE FROM admin_invitation_tokens WHERE invitation_token = $1;

-- name: DeleteExpiredAdminInvitationTokens :exec
DELETE FROM admin_invitation_tokens WHERE expires_at <= NOW();

-- name: CreateAdminUser :one
INSERT INTO admin_users (admin_user_id, email_address, full_name, status, preferred_language)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: UpdateAdminUserSetup :exec
UPDATE admin_users
SET password_hash = $2, full_name = $3
WHERE admin_user_id = $1;

-- name: UpdateAdminUserStatus :exec
UPDATE admin_users
SET status = $2
WHERE admin_user_id = $1;

-- name: UpdateAdminUserFullName :exec
UPDATE admin_users
SET full_name = $2
WHERE admin_user_id = $1;

-- name: DeleteAdminUser :exec
DELETE FROM admin_users WHERE admin_user_id = $1;
