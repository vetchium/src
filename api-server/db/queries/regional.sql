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

-- name: FilterAuditLogsWithEmail :many
SELECT
    al.id,
    al.event_type,
    al.ip_address,
    al.event_data,
    al.created_at,
    actor.email_address AS actor_email,
    target.email_address AS target_email
FROM audit_logs al
LEFT JOIN org_users actor ON al.actor_user_id = actor.org_user_id
LEFT JOIN org_users target ON al.target_user_id = target.org_user_id
WHERE
    al.org_id = @org_id
    AND (sqlc.narg('event_types')::text[] IS NULL OR al.event_type = ANY(sqlc.narg('event_types')::text[]))
    AND (sqlc.narg('actor_email')::text IS NULL OR actor.email_address = sqlc.narg('actor_email')::text)
    AND (sqlc.narg('start_time')::timestamptz IS NULL OR al.created_at >= sqlc.narg('start_time')::timestamptz)
    AND (sqlc.narg('end_time')::timestamptz IS NULL OR al.created_at <= sqlc.narg('end_time')::timestamptz)
    AND (sqlc.narg('cursor_created_at')::timestamptz IS NULL
         OR al.created_at < sqlc.narg('cursor_created_at')::timestamptz
         OR (al.created_at = sqlc.narg('cursor_created_at')::timestamptz AND al.id < sqlc.narg('cursor_id')::uuid))
ORDER BY al.created_at DESC, al.id DESC
LIMIT @limit_count;

-- name: FilterMyAuditLogsWithEmail :many
SELECT
    al.id,
    al.event_type,
    al.ip_address,
    al.event_data,
    al.created_at,
    actor.email_address AS actor_email,
    target.email_address AS target_email
FROM audit_logs al
LEFT JOIN org_users actor ON al.actor_user_id = actor.org_user_id
LEFT JOIN org_users target ON al.target_user_id = target.org_user_id
WHERE
    al.actor_user_id = @actor_user_id
    AND (sqlc.narg('event_types')::text[] IS NULL OR al.event_type = ANY(sqlc.narg('event_types')::text[]))
    AND (sqlc.narg('start_time')::timestamptz IS NULL OR al.created_at >= sqlc.narg('start_time')::timestamptz)
    AND (sqlc.narg('end_time')::timestamptz IS NULL OR al.created_at <= sqlc.narg('end_time')::timestamptz)
    AND (sqlc.narg('cursor_created_at')::timestamptz IS NULL
         OR al.created_at < sqlc.narg('cursor_created_at')::timestamptz
         OR (al.created_at = sqlc.narg('cursor_created_at')::timestamptz AND al.id < sqlc.narg('cursor_id')::uuid))
ORDER BY al.created_at DESC, al.id DESC
LIMIT @limit_count;

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

-- ---- Natural-key based SubOrg queries ----

-- name: GetSubOrgByOrgAndName :one
SELECT * FROM suborgs WHERE org_id = @org_id AND name = @name;

-- name: RenameSubOrgByName :one
UPDATE suborgs SET name = @new_name WHERE org_id = @org_id AND name = @name RETURNING *;

-- name: DisableSubOrgByName :one
UPDATE suborgs SET status = 'inactive' WHERE org_id = @org_id AND name = @name RETURNING *;

-- name: EnableSubOrgByName :one
UPDATE suborgs SET status = 'active' WHERE org_id = @org_id AND name = @name RETURNING *;

-- name: AddSubOrgMemberByEmail :exec
INSERT INTO org_user_suborg_assignments (suborg_id, org_user_id)
SELECT s.suborg_id, u.org_user_id
FROM suborgs s, org_users u
WHERE s.org_id = @org_id AND s.name = @suborg_name
  AND u.email_address = @email_address AND u.org_id = @org_id;

-- name: RemoveSubOrgMemberByEmail :exec
DELETE FROM org_user_suborg_assignments ousa
WHERE ousa.suborg_id = (SELECT s.suborg_id FROM suborgs s WHERE s.org_id = @org_id AND s.name = @suborg_name)
  AND ousa.org_user_id = (SELECT u.org_user_id FROM org_users u WHERE u.email_address = @email_address AND u.org_id = @org_id);

-- name: GetSubOrgMembershipByEmail :one
SELECT a.* FROM org_user_suborg_assignments a
JOIN suborgs s ON a.suborg_id = s.suborg_id
JOIN org_users u ON a.org_user_id = u.org_user_id
WHERE s.org_id = @org_id AND s.name = @suborg_name
  AND u.email_address = @email_address AND u.org_id = @org_id;

-- name: ListSubOrgMembersByName :many
SELECT u.org_user_id, u.full_name, u.email_address, a.assigned_at
FROM org_user_suborg_assignments a
JOIN org_users u ON a.org_user_id = u.org_user_id
JOIN suborgs s ON a.suborg_id = s.suborg_id
WHERE s.org_id = @org_id AND s.name = @suborg_name
  AND (@cursor_assigned_at::timestamp IS NULL
       OR (a.assigned_at > @cursor_assigned_at)
       OR (a.assigned_at = @cursor_assigned_at AND a.org_user_id > @cursor_id))
ORDER BY a.assigned_at ASC, a.org_user_id ASC
LIMIT @limit_count;

-- ============================================================
-- Marketplace V3: marketplace_enrollments queries
-- ============================================================

-- name: GetMarketplaceEnrollmentByOrgAndCapability :one
SELECT * FROM marketplace_enrollments
WHERE org_id = @org_id AND capability_slug = @capability_slug;

-- name: CreateMarketplaceEnrollmentPendingReview :one
INSERT INTO marketplace_enrollments (org_id, capability_slug, status, application_note)
VALUES (@org_id, @capability_slug, 'pending_review', @application_note)
ON CONFLICT (org_id, capability_slug) DO UPDATE
  SET status = 'pending_review', application_note = @application_note, updated_at = NOW()
  WHERE marketplace_enrollments.status IN ('rejected', 'expired')
RETURNING *;

-- name: CreateMarketplaceEnrollmentApproved :one
INSERT INTO marketplace_enrollments (org_id, capability_slug, status, application_note, approved_at)
VALUES (@org_id, @capability_slug, 'approved', @application_note, NOW())
ON CONFLICT (org_id, capability_slug) DO UPDATE
  SET status = 'approved', application_note = @application_note, approved_at = NOW(), updated_at = NOW()
  WHERE marketplace_enrollments.status IN ('rejected', 'expired')
RETURNING *;

-- name: AdminApproveMarketplaceEnrollment :one
UPDATE marketplace_enrollments
SET status = 'approved', approved_at = NOW(), expires_at = @expires_at,
    billing_reference = @billing_reference, review_note = @review_note, updated_at = NOW()
WHERE org_id = @org_id AND capability_slug = @capability_slug AND status = 'pending_review'
RETURNING *;

-- name: AdminRejectMarketplaceEnrollment :one
UPDATE marketplace_enrollments
SET status = 'rejected', review_note = @review_note, updated_at = NOW()
WHERE org_id = @org_id AND capability_slug = @capability_slug AND status = 'pending_review'
RETURNING *;

-- name: AdminSuspendMarketplaceEnrollment :one
UPDATE marketplace_enrollments
SET status = 'suspended', review_note = @review_note, updated_at = NOW()
WHERE org_id = @org_id AND capability_slug = @capability_slug AND status = 'approved'
RETURNING *;

-- name: AdminReinstateMarketplaceEnrollment :one
UPDATE marketplace_enrollments
SET status = 'approved', review_note = NULL, updated_at = NOW()
WHERE org_id = @org_id AND capability_slug = @capability_slug AND status = 'suspended'
RETURNING *;

-- name: AdminRenewMarketplaceEnrollment :one
UPDATE marketplace_enrollments
SET status = 'approved', expires_at = @expires_at, billing_reference = @billing_reference,
    review_note = @review_note, updated_at = NOW()
WHERE org_id = @org_id AND capability_slug = @capability_slug AND status IN ('approved', 'expired')
RETURNING *;

-- name: ExpireMarketplaceEnrollments :exec
UPDATE marketplace_enrollments
SET status = 'expired', updated_at = NOW()
WHERE status = 'approved' AND expires_at IS NOT NULL AND expires_at <= NOW();

-- name: ListMarketplaceEnrollmentsByOrg :many
SELECT * FROM marketplace_enrollments
WHERE org_id = @org_id
  AND (@pagination_key_updated_at::timestamptz IS NULL OR @pagination_key_capability_slug::text IS NULL
    OR (updated_at, capability_slug) < (@pagination_key_updated_at, @pagination_key_capability_slug::text))
ORDER BY updated_at DESC, capability_slug ASC
LIMIT @limit_count;

-- name: ListAllMarketplaceEnrollments :many
SELECT * FROM marketplace_enrollments
WHERE (sqlc.narg('filter_org_id')::uuid IS NULL OR org_id = sqlc.narg('filter_org_id')::uuid)
  AND (sqlc.narg('filter_capability_slug')::text IS NULL OR capability_slug = sqlc.narg('filter_capability_slug')::text)
  AND (sqlc.narg('filter_status')::marketplace_enrollment_status IS NULL OR status = sqlc.narg('filter_status')::marketplace_enrollment_status)
  AND (sqlc.narg('pagination_key')::text IS NULL OR capability_slug > sqlc.narg('pagination_key')::text)
ORDER BY capability_slug ASC
LIMIT @limit_count;

-- ============================================================
-- Marketplace V3: marketplace_offers queries
-- ============================================================

-- name: GetMarketplaceOfferByOrgAndCapability :one
SELECT * FROM marketplace_offers
WHERE org_id = @org_id AND capability_slug = @capability_slug;

-- name: CreateMarketplaceOffer :one
INSERT INTO marketplace_offers (enrollment_id, org_id, capability_slug, headline, summary, description, regions_served, pricing_hint, contact_mode, contact_value)
VALUES (@enrollment_id, @org_id, @capability_slug, @headline, @summary, @description, @regions_served, @pricing_hint, @contact_mode, @contact_value)
RETURNING *;

-- name: UpdateMarketplaceOffer :one
UPDATE marketplace_offers
SET headline = @headline, summary = @summary, description = @description,
    regions_served = @regions_served, pricing_hint = @pricing_hint,
    contact_mode = @contact_mode, contact_value = @contact_value, updated_at = NOW()
WHERE org_id = @org_id AND capability_slug = @capability_slug
  AND status IN ('draft', 'rejected', 'archived')
RETURNING *;

-- name: SubmitMarketplaceOfferForReview :one
UPDATE marketplace_offers
SET status = 'pending_review', updated_at = NOW()
WHERE org_id = @org_id AND capability_slug = @capability_slug AND status = 'draft'
RETURNING *;

-- name: SubmitMarketplaceOfferAutoApprove :one
UPDATE marketplace_offers
SET status = 'active', review_note = NULL, updated_at = NOW()
WHERE org_id = @org_id AND capability_slug = @capability_slug AND status = 'draft'
RETURNING *;

-- name: ArchiveMarketplaceOffer :one
UPDATE marketplace_offers
SET status = 'archived', updated_at = NOW()
WHERE org_id = @org_id AND capability_slug = @capability_slug
  AND status NOT IN ('archived')
RETURNING *;

-- name: AdminApproveMarketplaceOffer :one
UPDATE marketplace_offers
SET status = 'active', review_note = @review_note, updated_at = NOW()
WHERE org_id = @org_id AND capability_slug = @capability_slug AND status = 'pending_review'
RETURNING *;

-- name: AdminRejectMarketplaceOffer :one
UPDATE marketplace_offers
SET status = 'rejected', review_note = @review_note, updated_at = NOW()
WHERE org_id = @org_id AND capability_slug = @capability_slug AND status = 'pending_review'
RETURNING *;

-- name: AdminSuspendMarketplaceOffer :one
UPDATE marketplace_offers
SET status = 'suspended', review_note = @review_note, updated_at = NOW()
WHERE org_id = @org_id AND capability_slug = @capability_slug AND status IN ('pending_review', 'active')
RETURNING *;

-- name: AdminReinstateMarketplaceOffer :one
UPDATE marketplace_offers
SET status = 'active', review_note = NULL, updated_at = NOW()
WHERE org_id = @org_id AND capability_slug = @capability_slug AND status = 'suspended'
RETURNING *;

-- name: SuspendMarketplaceOffersByEnrollment :exec
UPDATE marketplace_offers
SET status = 'suspended', updated_at = NOW()
WHERE enrollment_id = @enrollment_id AND status IN ('active', 'pending_review');

-- name: ListMarketplaceOffers :many
SELECT * FROM marketplace_offers
WHERE (sqlc.narg('filter_status')::marketplace_offer_status IS NULL OR status = sqlc.narg('filter_status')::marketplace_offer_status)
  AND (sqlc.narg('filter_org_id')::uuid IS NULL OR org_id = sqlc.narg('filter_org_id')::uuid)
ORDER BY updated_at DESC, capability_slug ASC
LIMIT @limit_count;

-- ============================================================
-- Marketplace V3: marketplace_subscriptions queries
-- ============================================================

-- name: GetMarketplaceSubscriptionByConsumerAndProvider :one
SELECT * FROM marketplace_subscriptions
WHERE consumer_org_id = @consumer_org_id
  AND provider_org_global_id = @provider_org_global_id
  AND capability_slug = @capability_slug;

-- name: UpsertMarketplaceSubscriptionRequested :one
INSERT INTO marketplace_subscriptions (
    consumer_org_id, consumer_org_domain, provider_org_global_id, provider_org_domain,
    provider_region, capability_slug, request_note,
    requires_provider_review, requires_admin_review, requires_contract, requires_payment,
    status
) VALUES (
    @consumer_org_id, @consumer_org_domain, @provider_org_global_id, @provider_org_domain,
    @provider_region, @capability_slug, @request_note,
    @requires_provider_review, @requires_admin_review, @requires_contract, @requires_payment,
    'requested'
)
ON CONFLICT (consumer_org_id, provider_org_global_id, capability_slug) DO UPDATE
  SET request_note = @request_note, requires_provider_review = @requires_provider_review,
      requires_admin_review = @requires_admin_review, requires_contract = @requires_contract,
      requires_payment = @requires_payment, status = 'requested',
      review_note = NULL, starts_at = NULL, updated_at = NOW()
  WHERE marketplace_subscriptions.status IN ('rejected', 'cancelled', 'expired')
RETURNING *;

-- name: AdvanceMarketplaceSubscriptionStatus :one
UPDATE marketplace_subscriptions
SET status = @new_status, updated_at = NOW()
WHERE consumer_org_id = @consumer_org_id
  AND provider_org_global_id = @provider_org_global_id
  AND capability_slug = @capability_slug
  AND status = @expected_status
RETURNING *;

-- name: ActivateMarketplaceSubscription :one
UPDATE marketplace_subscriptions
SET status = 'active', starts_at = NOW(), updated_at = NOW()
WHERE consumer_org_id = @consumer_org_id
  AND provider_org_global_id = @provider_org_global_id
  AND capability_slug = @capability_slug
  AND status = @expected_status
RETURNING *;

-- name: CancelMarketplaceSubscription :one
UPDATE marketplace_subscriptions
SET status = 'cancelled', updated_at = NOW()
WHERE consumer_org_id = @consumer_org_id
  AND provider_org_global_id = @provider_org_global_id
  AND capability_slug = @capability_slug
  AND status NOT IN ('cancelled', 'expired', 'rejected')
RETURNING *;

-- name: ProviderRejectMarketplaceSubscription :one
UPDATE marketplace_subscriptions
SET status = 'rejected', review_note = @review_note, updated_at = NOW()
WHERE provider_org_global_id = @provider_org_global_id
  AND consumer_org_id = @consumer_org_id
  AND capability_slug = @capability_slug
  AND status = 'provider_review'
RETURNING *;

-- name: AdminRejectMarketplaceSubscription :one
UPDATE marketplace_subscriptions
SET status = 'rejected', review_note = @review_note, updated_at = NOW()
WHERE consumer_org_id = @consumer_org_id
  AND provider_org_global_id = @provider_org_global_id
  AND capability_slug = @capability_slug
  AND status = 'admin_review'
RETURNING *;

-- name: AdminActivateMarketplaceSubscription :one
UPDATE marketplace_subscriptions
SET status = 'active', starts_at = NOW(), updated_at = NOW()
WHERE consumer_org_id = @consumer_org_id
  AND provider_org_global_id = @provider_org_global_id
  AND capability_slug = @capability_slug
  AND status IN ('admin_review', 'awaiting_contract', 'awaiting_payment')
RETURNING *;

-- name: ListConsumerMarketplaceSubscriptions :many
SELECT * FROM marketplace_subscriptions
WHERE consumer_org_id = @consumer_org_id
  AND (@pagination_key_updated_at::timestamptz IS NULL
    OR (updated_at, provider_org_domain, capability_slug) < (@pagination_key_updated_at, @pagination_key_provider_domain::text, @pagination_key_capability_slug::text))
ORDER BY updated_at DESC, provider_org_domain ASC, capability_slug ASC
LIMIT @limit_count;

-- name: ListIncomingMarketplaceSubscriptions :many
SELECT * FROM marketplace_subscriptions
WHERE provider_org_global_id = @provider_org_global_id
  AND (sqlc.narg('filter_capability_slug')::text IS NULL OR capability_slug = sqlc.narg('filter_capability_slug')::text)
  AND (@pagination_key_updated_at::timestamptz IS NULL
    OR (updated_at, consumer_org_domain, capability_slug) < (@pagination_key_updated_at, @pagination_key_consumer_domain::text, @pagination_key_capability_slug::text))
ORDER BY updated_at DESC, consumer_org_domain ASC, capability_slug ASC
LIMIT @limit_count;

-- name: GetIncomingMarketplaceSubscription :one
SELECT * FROM marketplace_subscriptions
WHERE provider_org_global_id = @provider_org_global_id
  AND consumer_org_id = @consumer_org_id
  AND capability_slug = @capability_slug;

-- name: AdminCancelMarketplaceSubscription :one
UPDATE marketplace_subscriptions
SET status = 'cancelled', updated_at = NOW()
WHERE consumer_org_id = @consumer_org_id
  AND provider_org_global_id = @provider_org_global_id
  AND capability_slug = @capability_slug
  AND status NOT IN ('cancelled', 'expired', 'rejected')
RETURNING *;

-- name: ListAllMarketplaceSubscriptions :many
SELECT * FROM marketplace_subscriptions
WHERE (sqlc.narg('filter_consumer_org_id')::uuid IS NULL OR consumer_org_id = sqlc.narg('filter_consumer_org_id')::uuid)
  AND (sqlc.narg('filter_provider_org_global_id')::uuid IS NULL OR provider_org_global_id = sqlc.narg('filter_provider_org_global_id')::uuid)
  AND (sqlc.narg('filter_capability_slug')::text IS NULL OR capability_slug = sqlc.narg('filter_capability_slug')::text)
  AND (sqlc.narg('filter_status')::marketplace_subscription_status IS NULL OR status = sqlc.narg('filter_status')::marketplace_subscription_status)
  AND (sqlc.narg('pagination_key')::text IS NULL OR (consumer_org_domain, provider_org_domain, capability_slug) > (sqlc.narg('pagination_key')::text, '', ''))
ORDER BY consumer_org_domain ASC, provider_org_domain ASC, capability_slug ASC
LIMIT @limit_count;
