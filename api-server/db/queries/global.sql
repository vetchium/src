-- name: Ping :one
SELECT 1 AS ping;
-- name: GetHubUserByHandle :one
SELECT *
FROM hub_users
WHERE handle = $1;
-- name: GetHubUserByGlobalID :one
SELECT *
FROM hub_users
WHERE hub_user_global_id = $1;
-- name: GetHubUserByEmailHash :one
SELECT *
FROM hub_users
WHERE email_address_hash = $1;
-- Admin user queries
-- name: GetAdminUserByEmail :one
SELECT *
FROM admin_users
WHERE email_address = $1;
-- name: GetAdminUserByID :one
SELECT *
FROM admin_users
WHERE admin_user_id = $1;
-- name: CountActiveAdminUsers :one
SELECT COUNT(*)
FROM admin_users
WHERE status = 'active';
-- name: LockActiveAdminUsers :many
SELECT admin_user_id
FROM admin_users
WHERE status = 'active'
FOR UPDATE;
-- name: LockActiveAdminUsersWithRole :many
SELECT admin_users.admin_user_id
FROM admin_users
JOIN admin_user_roles ON admin_user_roles.admin_user_id = admin_users.admin_user_id
WHERE admin_user_roles.role_id = $1
  AND admin_users.status = 'active'
FOR UPDATE OF admin_users, admin_user_roles;
-- TFA token queries
-- name: CreateAdminTFAToken :exec
INSERT INTO admin_tfa_tokens (tfa_token, admin_user_id, tfa_code, expires_at)
VALUES ($1, $2, $3, $4);
-- name: GetAdminTFAToken :one
SELECT *
FROM admin_tfa_tokens
WHERE tfa_token = $1
  AND expires_at > NOW();
-- name: DeleteAdminTFAToken :exec
DELETE FROM admin_tfa_tokens
WHERE tfa_token = $1;
-- name: DeleteExpiredAdminTFATokens :exec
DELETE FROM admin_tfa_tokens
WHERE expires_at <= NOW();
-- Session queries
-- name: CreateAdminSession :exec
INSERT INTO admin_sessions (session_token, admin_user_id, expires_at)
VALUES ($1, $2, $3);
-- name: GetAdminSession :one
SELECT *
FROM admin_sessions
WHERE session_token = $1
  AND expires_at > NOW();
-- name: DeleteAdminSession :exec
DELETE FROM admin_sessions
WHERE session_token = $1;
-- name: DeleteExpiredAdminSessions :exec
DELETE FROM admin_sessions
WHERE expires_at <= NOW();
-- name: DeleteAllAdminSessionsForUser :exec
DELETE FROM admin_sessions
WHERE admin_user_id = $1;
-- Supported languages queries
-- name: GetSupportedLanguages :many
SELECT language_code,
  language_name,
  native_name,
  is_default
FROM supported_languages
ORDER BY is_default DESC,
  language_name ASC;
-- name: GetDefaultLanguage :one
SELECT language_code
FROM supported_languages
WHERE is_default = TRUE;
-- name: GetSupportedLanguage :one
SELECT language_code,
  language_name,
  native_name,
  is_default
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
SELECT ad.domain_id,
  ad.domain_name,
  ad.created_by_admin_id,
  ad.created_at,
  ad.updated_at,
  ad.status,
  au.email_address AS admin_email
FROM approved_domains ad
  JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.status = 'active'
ORDER BY ad.domain_name ASC
LIMIT $1;
-- name: ListApprovedDomainsActiveAfterCursor :many
SELECT ad.domain_id,
  ad.domain_name,
  ad.created_by_admin_id,
  ad.created_at,
  ad.updated_at,
  ad.status,
  au.email_address AS admin_email
FROM approved_domains ad
  JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.status = 'active'
  AND ad.domain_name > $1
ORDER BY ad.domain_name ASC
LIMIT $2;
-- name: ListApprovedDomainsInactiveFirstPage :many
SELECT ad.domain_id,
  ad.domain_name,
  ad.created_by_admin_id,
  ad.created_at,
  ad.updated_at,
  ad.status,
  au.email_address AS admin_email
FROM approved_domains ad
  JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.status = 'inactive'
ORDER BY ad.domain_name ASC
LIMIT $1;
-- name: ListApprovedDomainsInactiveAfterCursor :many
SELECT ad.domain_id,
  ad.domain_name,
  ad.created_by_admin_id,
  ad.created_at,
  ad.updated_at,
  ad.status,
  au.email_address AS admin_email
FROM approved_domains ad
  JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.status = 'inactive'
  AND ad.domain_name > $1
ORDER BY ad.domain_name ASC
LIMIT $2;
-- name: ListApprovedDomainsAllFirstPage :many
SELECT ad.domain_id,
  ad.domain_name,
  ad.created_by_admin_id,
  ad.created_at,
  ad.updated_at,
  ad.status,
  au.email_address AS admin_email
FROM approved_domains ad
  JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
ORDER BY ad.domain_name ASC
LIMIT $1;
-- name: ListApprovedDomainsAllAfterCursor :many
SELECT ad.domain_id,
  ad.domain_name,
  ad.created_by_admin_id,
  ad.created_at,
  ad.updated_at,
  ad.status,
  au.email_address AS admin_email
FROM approved_domains ad
  JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.domain_name > $1
ORDER BY ad.domain_name ASC
LIMIT $2;
-- name: SearchApprovedDomainsActiveFirstPage :many
SELECT ad.domain_id,
  ad.domain_name,
  ad.created_by_admin_id,
  ad.created_at,
  ad.updated_at,
  ad.status,
  au.email_address AS admin_email,
  similarity(ad.domain_name, @search_term) AS sim_score
FROM approved_domains ad
  JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.status = 'active'
  AND ad.domain_name ILIKE '%' || @search_term || '%'
ORDER BY sim_score DESC,
  ad.domain_name ASC
LIMIT @limit_count;
-- name: SearchApprovedDomainsActiveAfterCursor :many
SELECT ad.domain_id,
  ad.domain_name,
  ad.created_by_admin_id,
  ad.created_at,
  ad.updated_at,
  ad.status,
  au.email_address AS admin_email,
  similarity(ad.domain_name, @search_term) AS sim_score
FROM approved_domains ad
  JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.status = 'active'
  AND ad.domain_name ILIKE '%' || @search_term || '%'
  AND (
    similarity(ad.domain_name, @search_term) < @cursor_score::float4
    OR (
      similarity(ad.domain_name, @search_term) = @cursor_score::float4
      AND ad.domain_name > @cursor_domain
    )
  )
ORDER BY sim_score DESC,
  ad.domain_name ASC
LIMIT @limit_count;
-- name: SearchApprovedDomainsInactiveFirstPage :many
SELECT ad.domain_id,
  ad.domain_name,
  ad.created_by_admin_id,
  ad.created_at,
  ad.updated_at,
  ad.status,
  au.email_address AS admin_email,
  similarity(ad.domain_name, @search_term) AS sim_score
FROM approved_domains ad
  JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.status = 'inactive'
  AND ad.domain_name ILIKE '%' || @search_term || '%'
ORDER BY sim_score DESC,
  ad.domain_name ASC
LIMIT @limit_count;
-- name: SearchApprovedDomainsInactiveAfterCursor :many
SELECT ad.domain_id,
  ad.domain_name,
  ad.created_by_admin_id,
  ad.created_at,
  ad.updated_at,
  ad.status,
  au.email_address AS admin_email,
  similarity(ad.domain_name, @search_term) AS sim_score
FROM approved_domains ad
  JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.status = 'inactive'
  AND ad.domain_name ILIKE '%' || @search_term || '%'
  AND (
    similarity(ad.domain_name, @search_term) < @cursor_score::float4
    OR (
      similarity(ad.domain_name, @search_term) = @cursor_score::float4
      AND ad.domain_name > @cursor_domain
    )
  )
ORDER BY sim_score DESC,
  ad.domain_name ASC
LIMIT @limit_count;
-- name: SearchApprovedDomainsAllFirstPage :many
SELECT ad.domain_id,
  ad.domain_name,
  ad.created_by_admin_id,
  ad.created_at,
  ad.updated_at,
  ad.status,
  au.email_address AS admin_email,
  similarity(ad.domain_name, @search_term) AS sim_score
FROM approved_domains ad
  JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.domain_name ILIKE '%' || @search_term || '%'
ORDER BY sim_score DESC,
  ad.domain_name ASC
LIMIT @limit_count;
-- name: SearchApprovedDomainsAllAfterCursor :many
SELECT ad.domain_id,
  ad.domain_name,
  ad.created_by_admin_id,
  ad.created_at,
  ad.updated_at,
  ad.status,
  au.email_address AS admin_email,
  similarity(ad.domain_name, @search_term) AS sim_score
FROM approved_domains ad
  JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.domain_name ILIKE '%' || @search_term || '%'
  AND (
    similarity(ad.domain_name, @search_term) < @cursor_score::float4
    OR (
      similarity(ad.domain_name, @search_term) = @cursor_score::float4
      AND ad.domain_name > @cursor_domain
    )
  )
ORDER BY sim_score DESC,
  ad.domain_name ASC
LIMIT @limit_count;
-- name: GetApprovedDomainByID :one
SELECT *
FROM approved_domains
WHERE domain_id = $1;
-- name: GetApprovedDomainByName :one
SELECT *
FROM approved_domains
WHERE domain_name = $1;
-- name: GetApprovedDomainWithAdminByName :one
SELECT ad.domain_id,
  ad.domain_name,
  ad.created_by_admin_id,
  ad.created_at,
  ad.updated_at,
  ad.status,
  au.email_address AS admin_email
FROM approved_domains ad
  JOIN admin_users au ON ad.created_by_admin_id = au.admin_user_id
WHERE ad.domain_name = $1;
-- name: DisableApprovedDomain :one
UPDATE approved_domains
SET status = 'inactive'
WHERE domain_id = $1
  AND status = 'active'
RETURNING *;
-- name: EnableApprovedDomain :one
UPDATE approved_domains
SET status = 'active'
WHERE domain_id = $1
  AND status = 'inactive'
RETURNING *;
-- name: CountApprovedDomainsActive :one
SELECT COUNT(*)
FROM approved_domains
WHERE status = 'active';
-- name: CountApprovedDomainsAll :one
SELECT COUNT(*)
FROM approved_domains;
-- Hub signup tokens
-- name: CreateHubSignupToken :exec
INSERT INTO hub_signup_tokens (
    signup_token,
    email_address,
    email_address_hash,
    hashing_algorithm,
    expires_at
  )
VALUES ($1, $2, $3, $4, $5);
-- name: GetHubSignupToken :one
SELECT *
FROM hub_signup_tokens
WHERE signup_token = $1
  AND expires_at > NOW();
-- name: MarkHubSignupTokenConsumed :exec
UPDATE hub_signup_tokens
SET consumed_at = NOW()
WHERE signup_token = $1;
-- name: DeleteExpiredHubSignupTokens :exec
DELETE FROM hub_signup_tokens
WHERE expires_at <= NOW();
-- name: DeleteHubSignupToken :exec
DELETE FROM hub_signup_tokens
WHERE signup_token = $1;
-- name: GetActiveHubSignupTokenByEmailHash :one
SELECT *
FROM hub_signup_tokens
WHERE email_address_hash = $1
  AND expires_at > NOW()
ORDER BY created_at DESC
LIMIT 1;
-- Hub user creation (routing data only)
-- name: CreateHubUser :one
INSERT INTO hub_users (
    hub_user_global_id,
    handle,
    email_address_hash,
    hashing_algorithm,
    home_region
  )
VALUES (gen_random_uuid(), $1, $2, $3, $4)
RETURNING *;
-- name: CreateHubUserDisplayName :exec
INSERT INTO hub_user_display_names (
    hub_user_global_id,
    language_code,
    display_name,
    is_preferred
  )
VALUES ($1, $2, $3, $4);
-- name: GetHubUserDisplayNames :many
SELECT *
FROM hub_user_display_names
WHERE hub_user_global_id = $1
ORDER BY is_preferred DESC,
  language_code ASC;
-- name: GetHubUserPreferredDisplayName :one
SELECT display_name
FROM hub_user_display_names
WHERE hub_user_global_id = $1
  AND is_preferred = TRUE;
-- name: DeleteHubUser :exec
DELETE FROM hub_users
WHERE hub_user_global_id = $1;
-- Regions
-- name: GetActiveRegions :many
SELECT *
FROM available_regions
WHERE is_active = TRUE
ORDER BY region_name ASC;
-- name: GetRegionByCode :one
SELECT *
FROM available_regions
WHERE region_code = $1;
-- Domain validation (uses existing approved_domains table)
-- name: GetActiveDomainByName :one
SELECT *
FROM approved_domains
WHERE domain_name = $1
  AND status = 'active';
-- ============================================
-- Org User Queries
-- ============================================
-- name: GetOrgUserByEmailHash :one
-- Note: This returns ONE user but may fail if email exists for multiple orgs.
-- Prefer GetOrgUserByEmailHashAndOrg for login flows.
SELECT *
FROM org_users
WHERE email_address_hash = $1;
-- name: GetOrgUserByEmailHashAndOrg :one
-- Composite lookup for login flow - email + org uniquely identifies user
SELECT *
FROM org_users
WHERE email_address_hash = $1
  AND org_id = $2;
-- name: GetOrgUsersByEmailHash :many
-- Returns all org_users for a given email hash (for multi-org scenarios)
-- Note: status filtering now happens at the regional level
SELECT ou.*,
  o.org_name
FROM org_users ou
  JOIN orgs o ON ou.org_id = o.org_id
WHERE ou.email_address_hash = $1
ORDER BY o.org_name;
-- name: GetOrgUserByID :one
SELECT *
FROM org_users
WHERE org_user_id = $1;
-- name: CreateOrgUser :one
INSERT INTO org_users (
    email_address_hash,
    hashing_algorithm,
    org_id,
    home_region
  )
VALUES ($1, $2, $3, $4)
RETURNING *;
-- name: DeleteOrgUser :exec
DELETE FROM org_users
WHERE org_user_id = $1;
-- ============================================
-- Org Signup Token Queries (DNS-based domain verification)
-- ============================================
-- name: CreateOrgSignupToken :exec
INSERT INTO org_signup_tokens (
    signup_token,
    email_token,
    email_address,
    email_address_hash,
    hashing_algorithm,
    expires_at,
    home_region,
    domain
  )
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);
-- name: GetOrgSignupToken :one
SELECT *
FROM org_signup_tokens
WHERE signup_token = $1
  AND expires_at > NOW();
-- name: GetOrgSignupTokenByEmailToken :one
-- Get pending signup by email token (for complete-signup flow - proves email access)
SELECT *
FROM org_signup_tokens
WHERE email_token = $1
  AND expires_at > NOW()
  AND consumed_at IS NULL;
-- name: GetOrgSignupTokenByEmail :one
-- Get pending signup by email address (for resend email flow)
SELECT *
FROM org_signup_tokens
WHERE email_address = $1
  AND expires_at > NOW()
  AND consumed_at IS NULL
ORDER BY created_at DESC
LIMIT 1;
-- name: GetPendingSignupByDomain :one
-- Check if a domain has a pending (non-expired, non-consumed) signup
SELECT *
FROM org_signup_tokens
WHERE domain = $1
  AND expires_at > NOW()
  AND consumed_at IS NULL
LIMIT 1;
-- name: MarkOrgSignupTokenConsumed :exec
UPDATE org_signup_tokens
SET consumed_at = NOW()
WHERE signup_token = $1;
-- name: DeleteExpiredOrgSignupTokens :exec
DELETE FROM org_signup_tokens
WHERE expires_at <= NOW();
-- name: DeleteOrgSignupToken :exec
DELETE FROM org_signup_tokens
WHERE signup_token = $1;
-- name: GetActiveOrgSignupTokenByEmailHash :one
SELECT *
FROM org_signup_tokens
WHERE email_address_hash = $1
  AND expires_at > NOW()
ORDER BY created_at DESC
LIMIT 1;
-- ============================================
-- Org Queries
-- ============================================
-- name: CreateOrg :one
INSERT INTO orgs (org_name, region)
VALUES ($1, $2)
RETURNING *;
-- name: GetOrgByID :one
SELECT *
FROM orgs
WHERE org_id = $1;
-- name: GetOrgByDomain :one
-- Find org by domain name (for login flow routing)
-- Domain verification status is checked in regional DB
SELECT o.*
FROM orgs o
  JOIN global_org_domains god ON o.org_id = god.org_id
WHERE god.domain = $1;
-- name: DeleteOrg :exec
DELETE FROM orgs
WHERE org_id = $1;
-- ============================================
-- Global Org Domain Queries
-- ============================================
-- name: CreateGlobalOrgDomain :exec
INSERT INTO global_org_domains (domain, region, org_id, is_primary)
VALUES ($1, $2, $3, $4);
-- name: GetGlobalOrgDomain :one
SELECT *
FROM global_org_domains
WHERE domain = $1;
-- name: GetPrimaryDomainByOrg :one
SELECT domain
FROM global_org_domains
WHERE org_id = $1 AND is_primary = TRUE;
-- name: DeleteGlobalOrgDomain :exec
DELETE FROM global_org_domains
WHERE domain = $1;
-- name: GetGlobalOrgDomainsByOrg :many
SELECT *
FROM global_org_domains
WHERE org_id = $1
ORDER BY domain ASC;
-- ============================================
-- Hub User Email Update Queries
-- ============================================
-- name: UpdateHubUserEmailHash :exec
UPDATE hub_users
SET email_address_hash = $2
WHERE hub_user_global_id = $1;
-- ============================================
-- Admin Invitation Queries
-- ============================================
-- name: CreateAdminInvitationToken :exec
INSERT INTO admin_invitation_tokens (invitation_token, admin_user_id, expires_at)
VALUES ($1, $2, $3);
-- name: GetAdminInvitationToken :one
SELECT *
FROM admin_invitation_tokens
WHERE invitation_token = $1
  AND expires_at > NOW();
-- name: DeleteAdminInvitationToken :exec
DELETE FROM admin_invitation_tokens
WHERE invitation_token = $1;
-- name: DeleteExpiredAdminInvitationTokens :exec
DELETE FROM admin_invitation_tokens
WHERE expires_at <= NOW();
-- name: CreateAdminUser :one
INSERT INTO admin_users (
    admin_user_id,
    email_address,
    full_name,
    status,
    preferred_language
  )
VALUES ($1, $2, $3, $4, $5)
RETURNING *;
-- name: UpdateAdminUserSetup :exec
UPDATE admin_users
SET password_hash = $2,
  full_name = $3,
  preferred_language = COALESCE($4, preferred_language)
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
DELETE FROM admin_users
WHERE admin_user_id = $1;
-- Admin password reset token queries
-- name: CreateAdminPasswordResetToken :exec
INSERT INTO admin_password_reset_tokens (reset_token, admin_user_id, expires_at)
VALUES ($1, $2, $3);
-- name: GetAdminPasswordResetToken :one
SELECT *
FROM admin_password_reset_tokens
WHERE reset_token = $1
  AND expires_at > NOW();
-- name: DeleteAdminPasswordResetToken :exec
DELETE FROM admin_password_reset_tokens
WHERE reset_token = $1;
-- name: DeleteExpiredAdminPasswordResetTokens :exec
DELETE FROM admin_password_reset_tokens
WHERE expires_at <= NOW();
-- name: UpdateAdminUserPassword :exec
UPDATE admin_users
SET password_hash = $2
WHERE admin_user_id = $1;
-- name: DeleteAllAdminSessionsExceptCurrent :exec
DELETE FROM admin_sessions
WHERE admin_user_id = $1
  AND session_token != $2;
-- ============================================
-- RBAC Queries
-- ============================================
-- Role queries
-- name: GetRoleByName :one
SELECT *
FROM roles
WHERE role_name = $1;
-- name: GetAllRoles :many
SELECT *
FROM roles
ORDER BY role_name ASC;
-- Admin user role queries
-- name: GetAdminUserRoles :many
SELECT r.role_id,
  r.role_name,
  r.description,
  aur.assigned_at
FROM admin_user_roles aur
  JOIN roles r ON aur.role_id = r.role_id
WHERE aur.admin_user_id = $1
ORDER BY r.role_name ASC;
-- name: HasAdminUserRole :one
SELECT EXISTS(
    SELECT 1
    FROM admin_user_roles
    WHERE admin_user_id = $1
      AND role_id = $2
  ) AS has_role;
-- name: AssignAdminUserRole :exec
INSERT INTO admin_user_roles (admin_user_id, role_id)
VALUES ($1, $2);
-- name: RemoveAdminUserRole :exec
DELETE FROM admin_user_roles
WHERE admin_user_id = $1
  AND role_id = $2;
-- ============================================
-- Filter Users Queries
-- ============================================
-- Admin Users
-- name: FilterAdminUsers :many
SELECT u.admin_user_id,
  u.email_address,
  u.full_name,
  u.status,
  u.created_at,
  COALESCE(
    (
      SELECT array_agg(
          r.role_name
          ORDER BY r.role_name
        )
      FROM admin_user_roles aur
        JOIN roles r ON aur.role_id = r.role_id
      WHERE aur.admin_user_id = u.admin_user_id
    ),
    '{}'
  )::text [] AS roles
FROM admin_users u
WHERE (
    (
      sqlc.narg('filter_email')::text IS NULL
      AND sqlc.narg('filter_name')::text IS NULL
    )
    OR (
      sqlc.narg('filter_email')::text IS NOT NULL
      AND u.email_address ILIKE '%' || sqlc.narg('filter_email') || '%'
    )
    OR (
      sqlc.narg('filter_name')::text IS NOT NULL
      AND u.full_name ILIKE '%' || sqlc.narg('filter_name') || '%'
    )
  )
  AND (
    sqlc.narg('filter_status')::text IS NULL
    OR u.status::text = sqlc.narg('filter_status')
  )
  AND (
    @cursor_created_at::timestamptz IS NULL
    OR (
      u.created_at < @cursor_created_at
      OR (
        u.created_at = @cursor_created_at
        AND u.admin_user_id < @cursor_id
      )
    )
  )
ORDER BY u.created_at DESC,
  u.admin_user_id DESC
LIMIT @limit_count;
-- name: CountFilterAdminUsers :one
SELECT COUNT(*)
FROM admin_users
WHERE (
    sqlc.narg('filter_email')::text IS NULL
    OR email_address ILIKE '%' || sqlc.narg('filter_email') || '%'
  )
  AND (
    sqlc.narg('filter_name')::text IS NULL
    OR full_name ILIKE '%' || sqlc.narg('filter_name') || '%'
  )
  AND (
    sqlc.narg('filter_status')::text IS NULL
    OR status::text = sqlc.narg('filter_status')
  );
-- ============================================
-- Tag Queries
-- ============================================
-- name: CreateTag :exec
INSERT INTO tags (tag_id)
VALUES ($1);
-- name: GetTag :one
SELECT *
FROM tags
WHERE tag_id = $1;
-- name: TagExists :one
SELECT EXISTS(
    SELECT 1
    FROM tags
    WHERE tag_id = $1
  ) AS exists;
-- name: GetTagTranslations :many
SELECT locale,
  display_name,
  description
FROM tag_translations
WHERE tag_id = $1
ORDER BY locale;
-- name: UpsertTagTranslation :exec
INSERT INTO tag_translations (tag_id, locale, display_name, description)
VALUES ($1, $2, $3, $4)
ON CONFLICT (tag_id, locale) DO UPDATE
SET display_name = EXCLUDED.display_name,
  description = EXCLUDED.description;
-- name: DeleteTagTranslations :exec
DELETE FROM tag_translations
WHERE tag_id = $1;
-- name: FilterTagsAdmin :many
SELECT DISTINCT t.tag_id,
  t.small_icon_key,
  t.small_icon_content_type,
  t.large_icon_key,
  t.large_icon_content_type,
  t.created_at,
  t.updated_at
FROM tags t
  LEFT JOIN tag_translations ts ON ts.tag_id = t.tag_id
WHERE (
    @query::text = ''
    OR t.tag_id ILIKE '%' || @query || '%'
    OR ts.display_name ILIKE '%' || @query || '%'
  )
  AND (
    @pagination_key::text = ''
    OR t.tag_id > @pagination_key
  )
ORDER BY t.tag_id
LIMIT @limit_count;
-- name: GetTagWithLocale :one
SELECT t.tag_id,
  t.small_icon_key,
  t.small_icon_content_type,
  t.large_icon_key,
  t.large_icon_content_type,
  t.created_at,
  t.updated_at,
  COALESCE(tl.display_name, te.display_name, '') AS display_name,
  COALESCE(tl.description, te.description) AS description
FROM tags t
  LEFT JOIN tag_translations tl ON tl.tag_id = t.tag_id
  AND tl.locale = $2
  LEFT JOIN tag_translations te ON te.tag_id = t.tag_id
  AND te.locale = 'en-US'
WHERE t.tag_id = $1;
-- name: FilterTagsForLocale :many
SELECT DISTINCT ON (t.tag_id) t.tag_id,
  t.small_icon_key,
  t.small_icon_content_type,
  t.large_icon_key,
  t.large_icon_content_type,
  COALESCE(tl.display_name, te.display_name, '') AS display_name,
  COALESCE(tl.description, te.description) AS description
FROM tags t
  LEFT JOIN tag_translations tl ON tl.tag_id = t.tag_id
  AND tl.locale = @locale
  LEFT JOIN tag_translations te ON te.tag_id = t.tag_id
  AND te.locale = 'en-US'
  LEFT JOIN tag_translations ts ON ts.tag_id = t.tag_id
WHERE (
    @query::text = ''
    OR t.tag_id ILIKE '%' || @query || '%'
    OR ts.display_name ILIKE '%' || @query || '%'
  )
  AND (
    @pagination_key::text = ''
    OR t.tag_id > @pagination_key
  )
ORDER BY t.tag_id
LIMIT @limit_count;
-- name: UpdateTagSmallIcon :exec
UPDATE tags
SET small_icon_key = $2,
  small_icon_content_type = $3,
  updated_at = NOW()
WHERE tag_id = $1;
-- name: UpdateTagLargeIcon :exec
UPDATE tags
SET large_icon_key = $2,
  large_icon_content_type = $3,
  updated_at = NOW()
WHERE tag_id = $1;
-- name: ClearTagSmallIcon :exec
UPDATE tags
SET small_icon_key = NULL,
  small_icon_content_type = NULL,
  updated_at = NOW()
WHERE tag_id = $1;
-- name: ClearTagLargeIcon :exec
UPDATE tags
SET large_icon_key = NULL,
  large_icon_content_type = NULL,
  updated_at = NOW()
WHERE tag_id = $1;
-- name: DeleteTag :exec
DELETE FROM tags
WHERE tag_id = $1;
-- ============================================
-- Admin Audit Log Queries
-- ============================================
-- name: InsertAdminAuditLog :exec
INSERT INTO admin_audit_logs (event_type, actor_user_id, target_user_id, ip_address, event_data)
VALUES (@event_type, @actor_user_id, @target_user_id, @ip_address, @event_data);

-- name: FilterAdminAuditLogs :many
SELECT *
FROM admin_audit_logs
WHERE
    (sqlc.narg('event_types')::text[] IS NULL OR event_type = ANY(sqlc.narg('event_types')::text[]))
    AND (sqlc.narg('actor_user_id')::uuid IS NULL OR actor_user_id = sqlc.narg('actor_user_id')::uuid)
    AND (sqlc.narg('start_time')::timestamptz IS NULL OR created_at >= sqlc.narg('start_time')::timestamptz)
    AND (sqlc.narg('end_time')::timestamptz IS NULL OR created_at <= sqlc.narg('end_time')::timestamptz)
    AND (sqlc.narg('cursor_created_at')::timestamptz IS NULL
         OR created_at < sqlc.narg('cursor_created_at')::timestamptz
         OR (created_at = sqlc.narg('cursor_created_at')::timestamptz AND id < sqlc.narg('cursor_id')::uuid))
ORDER BY created_at DESC, id DESC
LIMIT @limit_count;

-- name: DeleteExpiredAdminAuditLogs :exec
DELETE FROM admin_audit_logs
WHERE created_at < NOW() - @retention_period::interval;


-- ============================================================
-- Org Tiers
-- ============================================================

-- name: ListPlans :many
SELECT t.*, COALESCE(tr.display_name, t.plan_id) AS display_name, COALESCE(tr.description, '') AS description
FROM plans t
LEFT JOIN plan_translations tr ON t.plan_id = tr.plan_id AND tr.locale = @locale::text
WHERE t.status = 'active'
ORDER BY t.display_order;

-- name: GetPlan :one
SELECT * FROM plans WHERE plan_id = @plan_id;

-- name: GetOrgPlan :one
SELECT s.*, t.plan_id AS plan_key, t.display_order, t.org_users_cap, t.domains_verified_cap,
       t.suborgs_cap, t.marketplace_listings_cap, t.audit_retention_days, t.self_upgradeable,
       t.status AS plan_status, t.created_at AS plan_created_at, t.updated_at AS plan_updated_at
FROM org_plans s
JOIN plans t ON s.current_plan_id = t.plan_id
WHERE s.org_id = @org_id;

-- name: UpsertOrgPlan :exec
INSERT INTO org_plans (org_id, current_plan_id, updated_by_admin_id, updated_by_org_user_id, note)
VALUES (@org_id, @current_plan_id, @updated_by_admin_id, @updated_by_org_user_id, @note);

-- name: UpdateOrgPlan :exec
UPDATE org_plans
SET current_plan_id = @current_plan_id, updated_at = NOW(),
    updated_by_admin_id = @updated_by_admin_id, updated_by_org_user_id = @updated_by_org_user_id, note = @note
WHERE org_id = @org_id;

-- name: InsertOrgPlanHistory :exec
INSERT INTO org_plan_history (org_id, from_plan_id, to_plan_id, changed_by_admin_id, changed_by_org_user_id, reason)
VALUES (@org_id, @from_plan_id, @to_plan_id, @changed_by_admin_id, @changed_by_org_user_id, @reason);

-- name: AdminListOrgPlans :many
SELECT s.*, COALESCE(gd.domain, o.org_name) AS org_domain
FROM org_plans s
JOIN orgs o ON s.org_id = o.org_id
LEFT JOIN global_org_domains gd ON gd.org_id = s.org_id
WHERE (sqlc.narg('filter_plan_id')::text IS NULL OR s.current_plan_id = sqlc.narg('filter_plan_id')::text)
  AND (sqlc.narg('filter_domain')::text IS NULL OR COALESCE(gd.domain, o.org_name) ILIKE '%' || sqlc.narg('filter_domain')::text || '%')
  AND (sqlc.narg('pagination_key')::uuid IS NULL OR s.org_id > sqlc.narg('pagination_key')::uuid)
GROUP BY s.org_id, s.current_plan_id, s.updated_at, s.updated_by_admin_id, s.updated_by_org_user_id, s.note, gd.domain, o.org_name
ORDER BY s.org_id ASC
LIMIT @row_limit;

-- name: CountOrgUsers :one
SELECT COUNT(*)::int FROM org_users WHERE org_id = @org_id;


-- Marketplace: capability catalog (global)

-- name: CreateCapability :exec
INSERT INTO marketplace_capabilities (capability_id, status)
VALUES (@capability_id, @status);

-- name: UpdateCapabilityStatus :exec
UPDATE marketplace_capabilities SET status = @status, updated_at = NOW()
WHERE capability_id = @capability_id;

-- name: UpsertCapabilityTranslation :exec
INSERT INTO marketplace_capability_translations (capability_id, locale, display_name, description)
VALUES (@capability_id, @locale, @display_name, @description)
ON CONFLICT (capability_id, locale) DO UPDATE
SET display_name = EXCLUDED.display_name, description = EXCLUDED.description;

-- name: GetCapability :one
SELECT c.*, COALESCE(tr.display_name, c.capability_id) AS display_name, COALESCE(tr.description, '') AS description
FROM marketplace_capabilities c
LEFT JOIN marketplace_capability_translations tr ON c.capability_id = tr.capability_id AND tr.locale = @locale::text
WHERE c.capability_id = @capability_id;

-- name: ListActiveCapabilities :many
SELECT c.capability_id, c.status, c.created_at, c.updated_at,
       COALESCE(tr.display_name, c.capability_id) AS display_name,
       COALESCE(tr.description, '') AS description
FROM marketplace_capabilities c
LEFT JOIN marketplace_capability_translations tr ON c.capability_id = tr.capability_id AND tr.locale = @locale::text
WHERE c.status = 'active'
ORDER BY c.capability_id;

-- name: ListAllCapabilities :many
SELECT c.capability_id, c.status, c.created_at, c.updated_at,
       COALESCE(tr.display_name, c.capability_id) AS display_name,
       COALESCE(tr.description, '') AS description
FROM marketplace_capabilities c
LEFT JOIN marketplace_capability_translations tr ON c.capability_id = tr.capability_id AND tr.locale = @locale::text
ORDER BY c.capability_id;

-- name: CapabilityExists :one
SELECT COUNT(*)::int FROM marketplace_capabilities WHERE capability_id = @capability_id AND status = 'active';

-- Marketplace: listing catalog (global)

-- name: UpsertListingCatalog :exec
INSERT INTO marketplace_listing_catalog (listing_id, org_id, org_domain, listing_number, headline, description, capability_ids, listed_at, updated_at)
VALUES (@listing_id, @org_id, @org_domain, @listing_number, @headline, @description, @capability_ids, @listed_at, NOW())
ON CONFLICT (listing_id) DO UPDATE
SET headline = EXCLUDED.headline, description = EXCLUDED.description,
    capability_ids = EXCLUDED.capability_ids, listed_at = EXCLUDED.listed_at, updated_at = NOW();

-- name: DeleteListingCatalog :exec
DELETE FROM marketplace_listing_catalog WHERE listing_id = @listing_id;

-- name: GetListingCatalogByDomainAndNumber :one
SELECT * FROM marketplace_listing_catalog
WHERE org_domain = @org_domain AND listing_number = @listing_number;

-- name: ListListingCatalogByCapability :many
SELECT * FROM marketplace_listing_catalog
WHERE (@capability_id::text = '' OR @capability_id::text = ANY(capability_ids))
  AND (sqlc.narg('pagination_key')::uuid IS NULL OR listing_id > sqlc.narg('pagination_key')::uuid)
  AND (@search_text::text = '' OR headline ILIKE '%' || @search_text::text || '%' OR description ILIKE '%' || @search_text::text || '%')
ORDER BY listing_id ASC
LIMIT @row_limit;

-- Marketplace: subscription index (global)

-- name: UpsertSubscriptionIndex :exec
INSERT INTO marketplace_subscription_index (subscription_id, listing_id, consumer_org_id, consumer_region, provider_org_id, provider_region, status, updated_at)
VALUES (@subscription_id, @listing_id, @consumer_org_id, @consumer_region, @provider_org_id, @provider_region, @status, NOW())
ON CONFLICT (consumer_org_id, listing_id) DO UPDATE
SET subscription_id = EXCLUDED.subscription_id, status = EXCLUDED.status, updated_at = NOW();

-- name: UpdateSubscriptionIndexStatus :exec
UPDATE marketplace_subscription_index SET status = @status, updated_at = NOW()
WHERE subscription_id = @subscription_id;

-- name: ListSubscriptionsForProvider :many
SELECT * FROM marketplace_subscription_index
WHERE provider_org_id = @provider_org_id
  AND (sqlc.narg('pagination_key')::uuid IS NULL OR subscription_id > sqlc.narg('pagination_key')::uuid)
ORDER BY subscription_id ASC
LIMIT @row_limit;
