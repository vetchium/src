-- name: Ping :one
SELECT 1 AS ping;
-- name: GetHubUserByEmail :one
SELECT *
FROM hub_users
WHERE email_address = $1;
-- name: GetHubUserByGlobalID :one
SELECT *
FROM hub_users
WHERE hub_user_global_id = $1;
-- name: CreateHubUser :one
INSERT INTO hub_users (hub_user_global_id, email_address, handle, password_hash, status, preferred_language, resident_country_code)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;
-- name: DeleteHubUser :exec
DELETE FROM hub_users
WHERE hub_user_global_id = $1;
-- name: UpdateHubUserPassword :exec
UPDATE hub_users
SET password_hash = $2
WHERE hub_user_global_id = $1;
-- name: DeleteAllHubSessionsForUser :exec
DELETE FROM hub_sessions
WHERE hub_user_global_id = $1;
-- name: DeleteAllHubSessionsExceptCurrent :exec
DELETE FROM hub_sessions
WHERE hub_user_global_id = $1
    AND session_token != $2;
-- Hub user status and preferences queries
-- name: UpdateHubUserStatus :exec
UPDATE hub_users
SET status = $2
WHERE hub_user_global_id = $1;
-- name: UpdateHubUserPreferredLanguage :exec
UPDATE hub_users
SET preferred_language = $2
WHERE hub_user_global_id = $1;
-- Hub TFA token queries
-- name: CreateHubTFAToken :exec
INSERT INTO hub_tfa_tokens (
        tfa_token,
        hub_user_global_id,
        tfa_code,
        expires_at
    )
VALUES ($1, $2, $3, $4);
-- name: GetHubTFAToken :one
SELECT *
FROM hub_tfa_tokens
WHERE tfa_token = $1
    AND expires_at > NOW();
-- name: DeleteHubTFAToken :exec
DELETE FROM hub_tfa_tokens
WHERE tfa_token = $1;
-- name: DeleteExpiredHubTFATokens :exec
DELETE FROM hub_tfa_tokens
WHERE expires_at <= NOW();
-- Hub session queries
-- name: CreateHubSession :exec
INSERT INTO hub_sessions (session_token, hub_user_global_id, expires_at)
VALUES ($1, $2, $3);
-- name: GetHubSession :one
SELECT *
FROM hub_sessions
WHERE session_token = $1
    AND expires_at > NOW();
-- name: DeleteHubSession :exec
DELETE FROM hub_sessions
WHERE session_token = $1;
-- name: DeleteExpiredHubSessions :exec
DELETE FROM hub_sessions
WHERE expires_at <= NOW();
-- Hub password reset token queries
-- name: CreateHubPasswordResetToken :exec
INSERT INTO hub_password_reset_tokens (reset_token, hub_user_global_id, expires_at)
VALUES ($1, $2, $3);
-- name: GetHubPasswordResetToken :one
SELECT *
FROM hub_password_reset_tokens
WHERE reset_token = $1
    AND expires_at > NOW();
-- name: DeleteHubPasswordResetToken :exec
DELETE FROM hub_password_reset_tokens
WHERE reset_token = $1;
-- name: DeleteExpiredHubPasswordResetTokens :exec
DELETE FROM hub_password_reset_tokens
WHERE expires_at <= NOW();
-- ============================================
-- Org User Queries (Regional)
-- ============================================
-- name: GetOrgUserByEmail :one
-- Note: This returns ONE user but may fail if email exists for multiple employers.
-- Prefer GetOrgUserByEmailAndEmployer for login flows.
SELECT *
FROM org_users
WHERE email_address = $1;
-- name: GetOrgUserByEmailAndOrg :one
-- Composite lookup for login flow - email + org uniquely identifies user
SELECT *
FROM org_users
WHERE email_address = $1
    AND org_id = $2;
-- name: GetOrgUserByID :one
SELECT *
FROM org_users
WHERE org_user_id = $1;
-- name: CreateOrgUser :one
INSERT INTO org_users (
        org_user_id,
        email_address,
        org_id,
        full_name,
        password_hash,
        status,
        preferred_language
    )
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;
-- name: DeleteOrgUser :exec
DELETE FROM org_users
WHERE org_user_id = $1;
-- Org user status and preferences queries
-- name: UpdateOrgUserStatus :exec
UPDATE org_users
SET status = $2
WHERE org_user_id = $1;
-- name: UpdateOrgUserPreferredLanguage :exec
UPDATE org_users
SET preferred_language = $2
WHERE org_user_id = $1;
-- name: UpdateOrgUserFullName :exec
UPDATE org_users
SET full_name = $2,
    preferred_language = COALESCE($3, preferred_language)
WHERE org_user_id = $1;
-- name: CountOrgUsersByOrg :one
SELECT COUNT(*)
FROM org_users
WHERE org_id = $1;
-- name: CountActiveOrgUsersWithRole :one
SELECT COUNT(*)
FROM org_users u
JOIN org_user_roles our ON our.org_user_id = u.org_user_id
WHERE u.org_id = $1
  AND our.role_id = $2
  AND u.status = 'active';
-- name: LockActiveOrgUsersWithRole :many
SELECT org_users.org_user_id
FROM org_users
JOIN org_user_roles ON org_user_roles.org_user_id = org_users.org_user_id
WHERE org_users.org_id = $1
  AND org_user_roles.role_id = $2
  AND org_users.status = 'active'
FOR UPDATE OF org_users, org_user_roles;
-- ============================================
-- Org TFA Token Queries
-- ============================================
-- name: CreateOrgTFAToken :exec
INSERT INTO org_tfa_tokens (tfa_token, org_user_id, tfa_code, expires_at)
VALUES ($1, $2, $3, $4);
-- name: GetOrgTFAToken :one
SELECT *
FROM org_tfa_tokens
WHERE tfa_token = $1
    AND expires_at > NOW();
-- name: DeleteOrgTFAToken :exec
DELETE FROM org_tfa_tokens
WHERE tfa_token = $1;
-- name: DeleteExpiredOrgTFATokens :exec
DELETE FROM org_tfa_tokens
WHERE expires_at <= NOW();
-- ============================================
-- Org Session Queries
-- ============================================
-- name: CreateOrgSession :exec
INSERT INTO org_sessions (session_token, org_user_id, expires_at)
VALUES ($1, $2, $3);
-- name: GetOrgSession :one
SELECT *
FROM org_sessions
WHERE session_token = $1
    AND expires_at > NOW();
-- name: DeleteOrgSession :exec
DELETE FROM org_sessions
WHERE session_token = $1;
-- name: DeleteExpiredOrgSessions :exec
DELETE FROM org_sessions
WHERE expires_at <= NOW();
-- name: DeleteAllOrgSessionsForUser :exec
DELETE FROM org_sessions
WHERE org_user_id = $1;
-- name: DeleteAllOrgSessionsExceptCurrent :exec
DELETE FROM org_sessions
WHERE org_user_id = $1
    AND session_token != $2;
-- ============================================
-- Org Password Reset Token Queries
-- ============================================
-- name: CreateOrgPasswordResetToken :exec
INSERT INTO org_password_reset_tokens (reset_token, org_user_global_id, expires_at)
VALUES ($1, $2, $3);
-- name: GetOrgPasswordResetToken :one
SELECT *
FROM org_password_reset_tokens
WHERE reset_token = $1
    AND expires_at > NOW();
-- name: DeleteOrgPasswordResetToken :exec
DELETE FROM org_password_reset_tokens
WHERE reset_token = $1;
-- name: DeleteExpiredOrgPasswordResetTokens :exec
DELETE FROM org_password_reset_tokens
WHERE expires_at <= NOW();
-- name: UpdateOrgUserPassword :exec
UPDATE org_users
SET password_hash = $2
WHERE org_user_id = $1;
-- ============================================
-- Org Invitation Token Queries
-- ============================================
-- name: CreateOrgInvitationToken :exec
INSERT INTO org_invitation_tokens (
        invitation_token,
        org_user_id,
        org_id,
        expires_at
    )
VALUES ($1, $2, $3, $4);
-- name: GetOrgInvitationToken :one
SELECT *
FROM org_invitation_tokens
WHERE invitation_token = $1
    AND expires_at > NOW();
-- name: DeleteOrgInvitationToken :exec
DELETE FROM org_invitation_tokens
WHERE invitation_token = $1;
-- name: DeleteExpiredOrgInvitationTokens :exec
DELETE FROM org_invitation_tokens
WHERE expires_at <= NOW();
-- name: UpdateOrgUserSetup :exec
UPDATE org_users
SET password_hash = $2,
    full_name = $3,
    authentication_type = $4,
    status = $5,
    preferred_language = COALESCE($6, preferred_language)
WHERE org_user_id = $1;
-- ============================================
-- Org Domain Queries (Regional)
-- ============================================
-- name: CreateOrgDomain :exec
INSERT INTO org_domains (
        domain,
        org_id,
        verification_token,
        token_expires_at,
        status,
        last_verification_requested_at,
        last_verified_at
    )
VALUES ($1, $2, $3, $4, $5, NULL, $6);
-- name: GetOrgDomain :one
SELECT *
FROM org_domains
WHERE domain = $1;
-- name: GetOrgDomainByOrgAndDomain :one
SELECT *
FROM org_domains
WHERE domain = $1
    AND org_id = $2;
-- name: UpdateOrgDomainStatus :exec
UPDATE org_domains
SET status = $2,
    last_verified_at = $3,
    consecutive_failures = $4
WHERE domain = $1;
-- name: UpdateOrgDomainToken :exec
UPDATE org_domains
SET verification_token = $2,
    token_expires_at = $3
WHERE domain = $1;
-- name: DeleteOrgDomain :exec
DELETE FROM org_domains
WHERE domain = $1;
-- name: GetOrgDomainsByOrg :many
SELECT *
FROM org_domains
WHERE org_id = $1
ORDER BY domain ASC;
-- name: IncrementOrgDomainFailures :exec
UPDATE org_domains
SET consecutive_failures = consecutive_failures + 1
WHERE domain = $1;
-- name: ResetOrgDomainFailures :exec
UPDATE org_domains
SET consecutive_failures = 0,
    last_verified_at = NOW()
WHERE domain = $1;
-- name: UpdateOrgDomainVerificationRequested :exec
UPDATE org_domains
SET last_verification_requested_at = NOW()
WHERE domain = $1;
-- name: UpdateOrgDomainTokenAndVerificationRequested :exec
UPDATE org_domains
SET verification_token = $2,
    token_expires_at = $3,
    last_verification_requested_at = NOW()
WHERE domain = $1;
-- name: GetOrgDomainsForReverification :many
SELECT *
FROM org_domains
WHERE (
        status = 'VERIFIED'
        AND last_verified_at < $1
    )
    OR status = 'FAILING';
-- ============================================
-- Filter Org Users Query (Regional)
-- ============================================
-- name: FilterOrgUsers :many
SELECT u.org_user_id,
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
            FROM org_user_roles our
                JOIN roles r ON our.role_id = r.role_id
            WHERE our.org_user_id = u.org_user_id
        ),
        '{}'
    )::text [] AS roles
FROM org_users u
WHERE u.org_id = @org_id
    AND (
        sqlc.narg('filter_email')::text IS NULL
        OR u.email_address ILIKE '%' || sqlc.narg('filter_email') || '%'
    )
    AND (
        sqlc.narg('filter_name')::text IS NULL
        OR u.full_name ILIKE '%' || sqlc.narg('filter_name') || '%'
    )
    AND (
        @cursor_created_at::timestamp IS NULL
        OR (
            u.created_at < @cursor_created_at
            OR (
                u.created_at = @cursor_created_at
                AND u.org_user_id < @cursor_id
            )
        )
    )
ORDER BY u.created_at DESC,
    u.org_user_id DESC
LIMIT @limit_count;
-- ============================================
-- Hub Email Verification Token Queries
-- ============================================
-- name: CreateHubEmailVerificationToken :exec
INSERT INTO hub_email_verification_tokens (
        verification_token,
        hub_user_global_id,
        new_email_address,
        expires_at
    )
VALUES ($1, $2, $3, $4);
-- name: GetHubEmailVerificationToken :one
SELECT *
FROM hub_email_verification_tokens
WHERE verification_token = $1
    AND expires_at > NOW();
-- name: DeleteHubEmailVerificationToken :exec
DELETE FROM hub_email_verification_tokens
WHERE verification_token = $1;
-- name: DeleteExpiredHubEmailVerificationTokens :exec
DELETE FROM hub_email_verification_tokens
WHERE expires_at <= NOW();
-- name: UpdateHubUserEmailAddress :exec
UPDATE hub_users
SET email_address = $2
WHERE hub_user_global_id = $1;
-- ============================================
-- RBAC Queries (Regional)
-- ============================================
-- Role queries
-- name: GetRoleByName :one
SELECT *
FROM roles
WHERE role_name = $1;
-- Org user role queries
-- name: GetOrgUserRoles :many
SELECT r.role_id,
  r.role_name,
  r.description,
  our.assigned_at
FROM org_user_roles our
  JOIN roles r ON our.role_id = r.role_id
WHERE our.org_user_id = $1
ORDER BY r.role_name ASC;
-- name: HasOrgUserRole :one
SELECT EXISTS(
    SELECT 1
    FROM org_user_roles
    WHERE org_user_id = $1
      AND role_id = $2
  ) AS has_role;
-- name: AssignOrgUserRole :exec
INSERT INTO org_user_roles (org_user_id, role_id)
VALUES ($1, $2);
-- name: RemoveOrgUserRole :exec
DELETE FROM org_user_roles
WHERE org_user_id = $1
  AND role_id = $2;
-- Hub user role queries
-- name: GetHubUserRoles :many
SELECT r.role_id,
  r.role_name,
  r.description,
  hur.assigned_at
FROM hub_user_roles hur
  JOIN roles r ON hur.role_id = r.role_id
WHERE hur.hub_user_global_id = $1
ORDER BY r.role_name ASC;
-- name: HasHubUserRole :one
SELECT EXISTS(
    SELECT 1
    FROM hub_user_roles
    WHERE hub_user_global_id = $1
      AND role_id = $2
  ) AS has_role;
-- name: AssignHubUserRole :exec
INSERT INTO hub_user_roles (hub_user_global_id, role_id)
VALUES ($1, $2);
-- name: CreateCostCenter :one
INSERT INTO cost_centers (org_id, id, display_name, notes)
VALUES (@org_id, @id, @display_name, @notes)
RETURNING *;

-- name: GetCostCenterByOrgAndID :one
SELECT * FROM cost_centers
WHERE org_id = @org_id AND id = @id;

-- name: UpdateCostCenter :one
UPDATE cost_centers
SET display_name = @display_name,
    status       = @status,
    notes        = @notes
WHERE org_id = @org_id AND id = @id
RETURNING *;

-- name: ListCostCenters :many
SELECT * FROM cost_centers
WHERE org_id = @org_id
  AND (sqlc.narg('filter_status')::cost_center_status IS NULL
       OR status = sqlc.narg('filter_status')::cost_center_status)
  AND (@cursor_created_at::timestamp IS NULL
       OR (created_at > @cursor_created_at)
       OR (created_at = @cursor_created_at AND cost_center_id > @cursor_id))
ORDER BY created_at ASC, cost_center_id ASC
LIMIT @limit_count;

-- ============================================
-- Audit Log Queries (Regional)
-- ============================================
-- name: InsertAuditLog :exec
INSERT INTO audit_logs (event_type, actor_user_id, target_user_id, org_id, ip_address, event_data)
VALUES (@event_type, @actor_user_id, @target_user_id, @org_id, @ip_address, @event_data);

-- name: FilterAuditLogs :many
SELECT *
FROM audit_logs
WHERE
    org_id = @org_id
    AND (sqlc.narg('event_types')::text[] IS NULL OR event_type = ANY(sqlc.narg('event_types')::text[]))
    AND (sqlc.narg('actor_user_id')::uuid IS NULL OR actor_user_id = sqlc.narg('actor_user_id')::uuid)
    AND (sqlc.narg('start_time')::timestamptz IS NULL OR created_at >= sqlc.narg('start_time')::timestamptz)
    AND (sqlc.narg('end_time')::timestamptz IS NULL OR created_at <= sqlc.narg('end_time')::timestamptz)
    AND (sqlc.narg('cursor_created_at')::timestamptz IS NULL
         OR created_at < sqlc.narg('cursor_created_at')::timestamptz
         OR (created_at = sqlc.narg('cursor_created_at')::timestamptz AND id < sqlc.narg('cursor_id')::uuid))
ORDER BY created_at DESC, id DESC
LIMIT @limit_count;

-- name: FilterMyAuditLogs :many
SELECT *
FROM audit_logs
WHERE
    actor_user_id = @actor_user_id
    AND (sqlc.narg('event_types')::text[] IS NULL OR event_type = ANY(sqlc.narg('event_types')::text[]))
    AND (sqlc.narg('start_time')::timestamptz IS NULL OR created_at >= sqlc.narg('start_time')::timestamptz)
    AND (sqlc.narg('end_time')::timestamptz IS NULL OR created_at <= sqlc.narg('end_time')::timestamptz)
    AND (sqlc.narg('cursor_created_at')::timestamptz IS NULL
         OR created_at < sqlc.narg('cursor_created_at')::timestamptz
         OR (created_at = sqlc.narg('cursor_created_at')::timestamptz AND id < sqlc.narg('cursor_id')::uuid))
ORDER BY created_at DESC, id DESC
LIMIT @limit_count;

-- name: DeleteExpiredAuditLogs :exec
DELETE FROM audit_logs
WHERE created_at < NOW() - @retention_period::interval;

-- ============================================
-- SubOrg Queries
-- ============================================

-- name: CountSubOrgsByOrg :one
SELECT COUNT(*) FROM suborgs WHERE org_id = @org_id;

-- name: CreateSubOrg :one
INSERT INTO suborgs (org_id, name, pinned_region)
VALUES (@org_id, @name, @pinned_region)
RETURNING *;

-- name: GetSubOrgByID :one
SELECT * FROM suborgs WHERE suborg_id = @suborg_id AND org_id = @org_id;

-- name: RenameSubOrg :one
UPDATE suborgs
SET name = @name
WHERE suborg_id = @suborg_id AND org_id = @org_id
RETURNING *;

-- name: UpdateSubOrgStatus :one
UPDATE suborgs
SET status = @status
WHERE suborg_id = @suborg_id AND org_id = @org_id
RETURNING *;

-- name: ListSubOrgs :many
SELECT * FROM suborgs
WHERE org_id = @org_id
  AND (sqlc.narg('filter_status')::text IS NULL OR status = sqlc.narg('filter_status')::text)
  AND (@cursor_created_at::timestamp IS NULL
       OR (created_at > @cursor_created_at)
       OR (created_at = @cursor_created_at AND suborg_id > @cursor_id))
ORDER BY created_at ASC, suborg_id ASC
LIMIT @limit_count;

-- name: AddSubOrgMember :exec
INSERT INTO org_user_suborg_assignments (suborg_id, org_user_id)
VALUES (@suborg_id, @org_user_id);

-- name: RemoveSubOrgMember :exec
DELETE FROM org_user_suborg_assignments
WHERE suborg_id = @suborg_id AND org_user_id = @org_user_id;

-- name: GetSubOrgMembership :one
SELECT * FROM org_user_suborg_assignments
WHERE suborg_id = @suborg_id AND org_user_id = @org_user_id;

-- name: ListSubOrgMembers :many
SELECT
    u.org_user_id,
    u.full_name,
    u.email_address,
    a.assigned_at
FROM org_user_suborg_assignments a
JOIN org_users u ON u.org_user_id = a.org_user_id
WHERE a.suborg_id = @suborg_id
  AND (@cursor_assigned_at::timestamp IS NULL
       OR (a.assigned_at > @cursor_assigned_at)
       OR (a.assigned_at = @cursor_assigned_at AND a.org_user_id > @cursor_id))
ORDER BY a.assigned_at ASC, a.org_user_id ASC
LIMIT @limit_count;

-- name: RevokeAllSubOrgAssignmentsForUser :exec
DELETE FROM org_user_suborg_assignments WHERE org_user_id = @org_user_id;

-- name: ListSubOrgMembersForNotification :many
SELECT u.email_address, u.preferred_language, u.org_user_id
FROM org_user_suborg_assignments a
JOIN org_users u ON u.org_user_id = a.org_user_id
WHERE a.suborg_id = @suborg_id;

-- ============================================================
-- Marketplace: org_capabilities queries
-- ============================================================

-- name: UpsertOrgCapabilityApply :one
INSERT INTO org_capabilities (org_id, capability, status, application_note, applied_at)
VALUES (@org_id, @capability, 'pending_approval', sqlc.narg('application_note'), NOW())
ON CONFLICT (org_id, capability)
DO UPDATE SET
    status           = 'pending_approval',
    application_note = sqlc.narg('application_note'),
    applied_at       = NOW(),
    updated_at       = NOW()
WHERE org_capabilities.status IN ('rejected', 'expired', 'revoked')
RETURNING *;

-- name: GetOrgCapability :one
SELECT * FROM org_capabilities
WHERE org_id = @org_id AND capability = @capability;

-- name: AdminApproveOrgCapability :one
UPDATE org_capabilities SET
    status             = 'active',
    admin_id           = @admin_id,
    admin_note         = NULL,
    subscription_price = @subscription_price,
    currency           = @currency,
    granted_at         = NOW(),
    expires_at         = @expires_at,
    updated_at         = NOW()
WHERE org_id = @org_id AND capability = @capability AND status = 'pending_approval'
RETURNING *;

-- name: AdminRejectOrgCapability :one
UPDATE org_capabilities SET
    status     = 'rejected',
    admin_id   = @admin_id,
    admin_note = @admin_note,
    updated_at = NOW()
WHERE org_id = @org_id AND capability = @capability AND status = 'pending_approval'
RETURNING *;

-- name: AdminRenewOrgCapability :one
UPDATE org_capabilities SET
    status             = 'active',
    admin_id           = @admin_id,
    subscription_price = @subscription_price,
    currency           = @currency,
    granted_at         = @granted_at,
    expires_at         = @expires_at,
    updated_at         = NOW()
WHERE org_id = @org_id AND capability = @capability AND status IN ('active', 'expired')
RETURNING *;

-- name: AdminRevokeOrgCapability :one
UPDATE org_capabilities SET
    status     = 'revoked',
    admin_id   = @admin_id,
    admin_note = @admin_note,
    updated_at = NOW()
WHERE org_id = @org_id AND capability = @capability AND status = 'active'
RETURNING *;

-- name: AdminReinstateOrgCapability :one
UPDATE org_capabilities SET
    status             = 'active',
    admin_id           = @admin_id,
    admin_note         = NULL,
    subscription_price = @subscription_price,
    currency           = @currency,
    granted_at         = NOW(),
    expires_at         = @expires_at,
    updated_at         = NOW()
WHERE org_id = @org_id AND capability = @capability AND status = 'revoked'
RETURNING *;

-- name: ListOrgCapabilities :many
SELECT * FROM org_capabilities
WHERE
    (sqlc.narg('filter_status')::org_capability_status IS NULL OR status = sqlc.narg('filter_status')::org_capability_status)
    AND (sqlc.narg('filter_org_id')::uuid IS NULL OR org_id = sqlc.narg('filter_org_id')::uuid)
    AND (sqlc.narg('cursor_updated_at')::timestamptz IS NULL
         OR updated_at < sqlc.narg('cursor_updated_at')::timestamptz
         OR (updated_at = sqlc.narg('cursor_updated_at')::timestamptz AND org_id < sqlc.narg('cursor_org_id')::uuid))
ORDER BY updated_at DESC, org_id DESC
LIMIT @limit_count;

-- name: ExpireOrgCapabilities :exec
UPDATE org_capabilities SET
    status     = 'expired',
    updated_at = NOW()
WHERE status = 'active' AND expires_at < NOW();

-- ============================================================
-- Marketplace: marketplace_service_listings queries
-- ============================================================

-- name: CreateServiceListing :one
INSERT INTO marketplace_service_listings (
    org_id, name, short_blurb, description, service_category,
    countries_of_service, contact_url, pricing_info,
    industries_served, industries_served_other, company_sizes_served,
    job_functions_sourced, seniority_levels_sourced, geographic_sourcing_regions
) VALUES (
    @org_id, @name, @short_blurb, @description, @service_category,
    @countries_of_service, @contact_url, sqlc.narg('pricing_info'),
    @industries_served, sqlc.narg('industries_served_other'), @company_sizes_served,
    @job_functions_sourced, @seniority_levels_sourced, @geographic_sourcing_regions
)
RETURNING *;

-- name: GetServiceListingByID :one
SELECT * FROM marketplace_service_listings
WHERE service_listing_id = @service_listing_id;

-- name: GetServiceListingByIDAndOrg :one
SELECT * FROM marketplace_service_listings
WHERE service_listing_id = @service_listing_id AND org_id = @org_id;

-- name: CountNonArchivedServiceListings :one
SELECT COUNT(*) FROM marketplace_service_listings
WHERE org_id = @org_id AND state != 'archived';

-- name: UpdateServiceListingDraft :one
UPDATE marketplace_service_listings SET
    name                     = @name,
    short_blurb              = @short_blurb,
    description              = @description,
    countries_of_service     = @countries_of_service,
    contact_url              = @contact_url,
    pricing_info             = sqlc.narg('pricing_info'),
    industries_served        = @industries_served,
    industries_served_other  = sqlc.narg('industries_served_other'),
    company_sizes_served     = @company_sizes_served,
    job_functions_sourced    = @job_functions_sourced,
    seniority_levels_sourced = @seniority_levels_sourced,
    geographic_sourcing_regions = @geographic_sourcing_regions,
    updated_at               = NOW()
WHERE service_listing_id = @service_listing_id AND org_id = @org_id AND state = 'draft'
RETURNING *;

-- name: UpdateServiceListingToPendingReview :one
UPDATE marketplace_service_listings SET
    name                     = @name,
    short_blurb              = @short_blurb,
    description              = @description,
    countries_of_service     = @countries_of_service,
    contact_url              = @contact_url,
    pricing_info             = sqlc.narg('pricing_info'),
    industries_served        = @industries_served,
    industries_served_other  = sqlc.narg('industries_served_other'),
    company_sizes_served     = @company_sizes_served,
    job_functions_sourced    = @job_functions_sourced,
    seniority_levels_sourced = @seniority_levels_sourced,
    geographic_sourcing_regions = @geographic_sourcing_regions,
    state                    = 'pending_review',
    updated_at               = NOW()
WHERE service_listing_id = @service_listing_id AND org_id = @org_id AND state IN ('active', 'paused')
RETURNING *;

-- name: UpdateRejectedServiceListing :one
UPDATE marketplace_service_listings SET
    name                     = @name,
    short_blurb              = @short_blurb,
    description              = @description,
    countries_of_service     = @countries_of_service,
    contact_url              = @contact_url,
    pricing_info             = sqlc.narg('pricing_info'),
    industries_served        = @industries_served,
    industries_served_other  = sqlc.narg('industries_served_other'),
    company_sizes_served     = @company_sizes_served,
    job_functions_sourced    = @job_functions_sourced,
    seniority_levels_sourced = @seniority_levels_sourced,
    geographic_sourcing_regions = @geographic_sourcing_regions,
    changed_since_rejection  = true,
    updated_at               = NOW()
WHERE service_listing_id = @service_listing_id AND org_id = @org_id AND state = 'rejected'
RETURNING *;

-- name: SubmitServiceListingForReview :one
UPDATE marketplace_service_listings SET
    state                   = 'pending_review',
    changed_since_rejection = false,
    updated_at              = NOW()
WHERE service_listing_id = @service_listing_id AND org_id = @org_id
  AND (
    (state = 'draft')
    OR (state = 'rejected' AND changed_since_rejection = true)
  )
RETURNING *;

-- name: PauseServiceListing :one
UPDATE marketplace_service_listings SET
    state      = 'paused',
    updated_at = NOW()
WHERE service_listing_id = @service_listing_id AND org_id = @org_id AND state = 'active'
RETURNING *;

-- name: UnpauseServiceListing :one
UPDATE marketplace_service_listings SET
    state      = 'pending_review',
    updated_at = NOW()
WHERE service_listing_id = @service_listing_id AND org_id = @org_id AND state = 'paused'
RETURNING *;

-- name: ArchiveServiceListing :one
UPDATE marketplace_service_listings SET
    state      = 'archived',
    updated_at = NOW()
WHERE service_listing_id = @service_listing_id AND org_id = @org_id
  AND state IN ('draft', 'active', 'paused', 'rejected', 'suspended', 'appealing')
RETURNING *;

-- name: SubmitServiceListingAppeal :one
UPDATE marketplace_service_listings SET
    state               = 'appealing',
    appeal_reason       = @appeal_reason,
    appeal_submitted_at = NOW(),
    appeal_admin_note   = NULL,
    appeal_decided_at   = NULL,
    updated_at          = NOW()
WHERE service_listing_id = @service_listing_id AND org_id = @org_id
  AND state = 'suspended' AND appeal_exhausted = false
RETURNING *;

-- name: ListProviderServiceListings :many
SELECT * FROM marketplace_service_listings
WHERE org_id = @org_id
    AND (sqlc.narg('filter_state')::service_listing_state IS NULL OR state = sqlc.narg('filter_state')::service_listing_state)
    AND (sqlc.narg('cursor_created_at')::timestamptz IS NULL
         OR created_at < sqlc.narg('cursor_created_at')::timestamptz
         OR (created_at = sqlc.narg('cursor_created_at')::timestamptz AND service_listing_id < sqlc.narg('cursor_id')::uuid))
ORDER BY created_at DESC, service_listing_id DESC
LIMIT @limit_count;

-- name: AdminApproveServiceListing :one
UPDATE marketplace_service_listings SET
    state                       = 'active',
    last_review_admin_id        = @admin_id,
    last_review_admin_note      = @admin_note,
    last_review_verification_id = @verification_id,
    last_reviewed_at            = NOW(),
    last_activated_at           = NOW(),
    updated_at                  = NOW()
WHERE service_listing_id = @service_listing_id AND state = 'pending_review'
RETURNING *;

-- name: AdminRejectServiceListing :one
UPDATE marketplace_service_listings SET
    state                       = 'rejected',
    changed_since_rejection     = false,
    last_review_admin_id        = @admin_id,
    last_review_admin_note      = @admin_note,
    last_review_verification_id = sqlc.narg('verification_id'),
    last_reviewed_at            = NOW(),
    updated_at                  = NOW()
WHERE service_listing_id = @service_listing_id AND state = 'pending_review'
RETURNING *;

-- name: AdminSuspendServiceListing :one
UPDATE marketplace_service_listings SET
    state                  = 'suspended',
    last_review_admin_id   = @admin_id,
    last_review_admin_note = @admin_note,
    last_reviewed_at       = NOW(),
    appeal_exhausted       = false,
    updated_at             = NOW()
WHERE service_listing_id = @service_listing_id AND state = 'active'
RETURNING *;

-- name: AdminReinstateServiceListing :one
UPDATE marketplace_service_listings SET
    state                  = 'active',
    last_review_admin_id   = @admin_id,
    last_review_admin_note = sqlc.narg('admin_note'),
    last_reviewed_at       = NOW(),
    last_activated_at      = NOW(),
    appeal_exhausted       = false,
    updated_at             = NOW()
WHERE service_listing_id = @service_listing_id AND state = 'suspended'
RETURNING *;

-- name: AdminGrantAppeal :one
UPDATE marketplace_service_listings SET
    state             = 'active',
    appeal_admin_note = @admin_note,
    appeal_decided_at = NOW(),
    last_activated_at = NOW(),
    appeal_exhausted  = false,
    updated_at        = NOW()
WHERE service_listing_id = @service_listing_id AND state = 'appealing'
RETURNING *;

-- name: AdminDenyAppeal :one
UPDATE marketplace_service_listings SET
    state             = 'suspended',
    appeal_admin_note = @admin_note,
    appeal_decided_at = NOW(),
    appeal_exhausted  = true,
    updated_at        = NOW()
WHERE service_listing_id = @service_listing_id AND state = 'appealing'
RETURNING *;

-- name: AdminListServiceListings :many
SELECT sl.* FROM marketplace_service_listings sl
WHERE
    (sqlc.narg('filter_state')::service_listing_state IS NULL OR sl.state = sqlc.narg('filter_state')::service_listing_state)
    AND (sqlc.narg('filter_org_id')::uuid IS NULL OR sl.org_id = sqlc.narg('filter_org_id')::uuid)
    AND (NOT sqlc.narg('has_reports')::boolean
         OR EXISTS (SELECT 1 FROM marketplace_service_listing_reports r WHERE r.service_listing_id = sl.service_listing_id))
    AND (sqlc.narg('cursor_created_at')::timestamptz IS NULL
         OR sl.created_at < sqlc.narg('cursor_created_at')::timestamptz
         OR (sl.created_at = sqlc.narg('cursor_created_at')::timestamptz AND sl.service_listing_id < sqlc.narg('cursor_id')::uuid))
ORDER BY sl.created_at DESC, sl.service_listing_id DESC
LIMIT @limit_count;

-- name: BrowseActiveServiceListings :many
SELECT sl.service_listing_id, sl.org_id, sl.name, sl.short_blurb,
       sl.service_category, sl.countries_of_service, sl.created_at
FROM marketplace_service_listings sl
JOIN org_capabilities oc ON oc.org_id = sl.org_id AND oc.capability = 'marketplace_provider'
WHERE sl.state = 'active'
  AND oc.status = 'active'
  AND (sqlc.narg('keyword')::text IS NULL
       OR sl.name ILIKE '%' || sqlc.narg('keyword')::text || '%'
       OR sl.short_blurb ILIKE '%' || sqlc.narg('keyword')::text || '%')
  AND (sqlc.narg('service_category')::service_category IS NULL OR sl.service_category = sqlc.narg('service_category')::service_category)
  AND (sqlc.narg('industries')::text[] IS NULL OR sl.industries_served && sqlc.narg('industries')::text[])
  AND (sqlc.narg('company_sizes')::text[] IS NULL OR sl.company_sizes_served && sqlc.narg('company_sizes')::text[])
  AND (sqlc.narg('job_functions')::text[] IS NULL OR sl.job_functions_sourced && sqlc.narg('job_functions')::text[])
  AND (sqlc.narg('seniority_levels')::text[] IS NULL OR sl.seniority_levels_sourced && sqlc.narg('seniority_levels')::text[])
  AND (sqlc.narg('countries_of_service')::text[] IS NULL OR sl.countries_of_service && sqlc.narg('countries_of_service')::text[])
  AND (sqlc.narg('geographic_sourcing_regions')::text[] IS NULL OR sl.geographic_sourcing_regions && sqlc.narg('geographic_sourcing_regions')::text[])
  AND (sqlc.narg('cursor_created_at')::timestamptz IS NULL
       OR sl.created_at < sqlc.narg('cursor_created_at')::timestamptz
       OR (sl.created_at = sqlc.narg('cursor_created_at')::timestamptz AND sl.service_listing_id < sqlc.narg('cursor_id')::uuid))
ORDER BY sl.created_at DESC, sl.service_listing_id DESC
LIMIT @limit_count;

-- name: GetActiveServiceListingByID :one
SELECT sl.* FROM marketplace_service_listings sl
JOIN org_capabilities oc ON oc.org_id = sl.org_id AND oc.capability = 'marketplace_provider'
WHERE sl.service_listing_id = @service_listing_id
  AND sl.state = 'active'
  AND oc.status = 'active';

-- ============================================================
-- Marketplace: marketplace_service_listing_reports queries
-- ============================================================

-- name: CreateServiceListingReport :one
INSERT INTO marketplace_service_listing_reports (
    service_listing_id, reporter_org_user_id, reporter_org_id, reason, reason_other
) VALUES (
    @service_listing_id, @reporter_org_user_id, @reporter_org_id, @reason, sqlc.narg('reason_other')
)
RETURNING *;

-- name: CountServiceListingReports :one
SELECT COUNT(*) FROM marketplace_service_listing_reports
WHERE service_listing_id = @service_listing_id;

-- name: GetServiceListingReport :one
SELECT * FROM marketplace_service_listing_reports
WHERE service_listing_id = @service_listing_id AND reporter_org_user_id = @reporter_org_user_id;
