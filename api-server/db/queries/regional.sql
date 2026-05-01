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
-- Note: This returns ONE user but may fail if email exists for multiple orgs.
-- Prefer GetOrgUserByEmailAndOrg for login flows.
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
-- name: GetOrgUserWithDomainWarning :one
-- Returns org user fields plus a boolean indicating whether the org has any FAILING domains.
-- Single round-trip: used by myinfo to avoid a separate failing-domain query.
SELECT u.*,
    EXISTS (
        SELECT 1 FROM org_domains d
        WHERE d.org_id = u.org_id AND d.status = 'FAILING'
    ) AS has_failing_domains
FROM org_users u
WHERE u.org_user_id = $1;
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
    consecutive_failures = $4,
    failing_since = $5
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
-- name: GetFailingPrimaryDomainsForFailover :many
-- Returns org_id + domain for primary domains that have been FAILING for longer than
-- PrimaryFailoverGrace. Used by the background worker to trigger auto-promotion.
SELECT r.org_id, r.domain
FROM org_domains r
WHERE r.status = 'FAILING'
    AND r.failing_since IS NOT NULL
    AND r.failing_since < $1;
-- name: GetOrgDomainCountByStatus :one
SELECT COUNT(*)::INT as count
FROM org_domains
WHERE org_id = $1
    AND status = $2;
-- name: HasOrgDomainInUseByMarketplaceListing :one
SELECT EXISTS (
    SELECT 1 FROM marketplace_listings
    WHERE org_domain = $1
        AND status NOT IN ('archived')
) AS in_use;
-- name: GetOrgFailingDomainCount :one
SELECT COUNT(*)::INT as count
FROM org_domains
WHERE org_id = $1
    AND status = 'FAILING';
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
-- name: GetOrgUserRolesWithDomainWarning :one
-- Single round-trip for myinfo: returns role list + has_failing_domains in one query.
SELECT COALESCE(
        (
            SELECT array_agg(r2.role_name ORDER BY r2.role_name)
            FROM org_user_roles our2
            JOIN roles r2 ON our2.role_id = r2.role_id
            WHERE our2.org_user_id = $1
        ),
        '{}'
    )::text[] AS roles,
    EXISTS (
        SELECT 1 FROM org_domains d WHERE d.org_id = $2 AND d.status = 'FAILING'
    ) AS has_failing_domains;
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
-- Company Address Queries (Regional)
-- ============================================

-- name: CreateOrgAddress :one
INSERT INTO org_addresses (org_id, title, address_line1, address_line2, city, state, postal_code, country, map_urls)
VALUES (@org_id, @title, @address_line1, @address_line2, @city, @state, @postal_code, @country, @map_urls)
RETURNING *;

-- name: GetOrgAddress :one
SELECT * FROM org_addresses
WHERE address_id = @address_id AND org_id = @org_id;

-- name: UpdateOrgAddress :one
UPDATE org_addresses
SET title         = @title,
    address_line1 = @address_line1,
    address_line2 = @address_line2,
    city          = @city,
    state         = @state,
    postal_code   = @postal_code,
    country       = @country,
    map_urls      = @map_urls,
    updated_at    = NOW()
WHERE address_id = @address_id AND org_id = @org_id
RETURNING *;

-- name: DisableOrgAddress :one
UPDATE org_addresses
SET status = 'disabled', updated_at = NOW()
WHERE address_id = @address_id AND org_id = @org_id AND status = 'active'
RETURNING *;

-- name: EnableOrgAddress :one
UPDATE org_addresses
SET status = 'active', updated_at = NOW()
WHERE address_id = @address_id AND org_id = @org_id AND status = 'disabled'
RETURNING *;

-- name: ListOrgAddresses :many
SELECT * FROM org_addresses
WHERE org_id = @org_id
  AND (sqlc.narg('filter_status')::org_address_status IS NULL
       OR status = sqlc.narg('filter_status')::org_address_status)
  AND (@cursor_created_at::timestamp IS NULL
       OR (created_at > @cursor_created_at)
       OR (created_at = @cursor_created_at AND address_id > @cursor_id))
ORDER BY created_at ASC, address_id ASC
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

-- name: IsOrgUserSuperAdmin :one
SELECT EXISTS(
    SELECT 1
    FROM org_user_roles our
    JOIN roles r ON our.role_id = r.role_id
    WHERE our.org_user_id = @org_user_id
      AND r.role_name = 'org:superadmin'
) AS is_superadmin;


-- name: CountSubOrgsForOrg :one
SELECT COUNT(*)::int FROM suborgs WHERE org_id = @org_id;

-- name: CountVerifiedDomainsForOrg :one
SELECT COUNT(*)::int FROM org_domains WHERE org_id = @org_id AND status = 'VERIFIED';

-- Marketplace: listings

-- name: NextListingNumberForOrg :one
INSERT INTO org_marketplace_listing_counters (org_id, last_listing_number)
VALUES (@org_id, 1)
ON CONFLICT (org_id) DO UPDATE SET last_listing_number = org_marketplace_listing_counters.last_listing_number + 1
RETURNING last_listing_number;

-- name: CreateMarketplaceListing :one
INSERT INTO marketplace_listings (org_id, org_domain, listing_number, headline, description, status)
VALUES (@org_id, @org_domain, @listing_number, @headline, @description, 'draft')
RETURNING *;

-- name: GetMarketplaceListing :one
SELECT * FROM marketplace_listings WHERE listing_id = @listing_id;

-- name: GetMarketplaceListingByDomainAndNumber :one
SELECT ml.*,
       COALESCE(array_agg(mlc.capability_id) FILTER (WHERE mlc.capability_id IS NOT NULL), '{}')::text[] as capabilities
FROM marketplace_listings ml
LEFT JOIN marketplace_listing_capabilities mlc ON ml.listing_id = mlc.listing_id AND mlc.removed_at IS NULL
WHERE ml.org_domain = @org_domain AND ml.listing_number = @listing_number
GROUP BY ml.listing_id;

-- name: ListMarketplaceListingsByOrg :many
SELECT ml.*,
       COALESCE(array_agg(mlc.capability_id) FILTER (WHERE mlc.capability_id IS NOT NULL), '{}')::text[] as capabilities
FROM marketplace_listings ml
LEFT JOIN marketplace_listing_capabilities mlc ON ml.listing_id = mlc.listing_id AND mlc.removed_at IS NULL
WHERE ml.org_id = @org_id
  AND (sqlc.narg('filter_status')::marketplace_listing_status IS NULL OR ml.status = sqlc.narg('filter_status')::marketplace_listing_status)
  AND (sqlc.narg('pagination_key')::uuid IS NULL OR ml.listing_id > sqlc.narg('pagination_key')::uuid)
GROUP BY ml.listing_id
ORDER BY ml.listing_id ASC
LIMIT @row_limit;

-- name: UpdateMarketplaceListing :one
UPDATE marketplace_listings
SET headline = @headline, description = @description, updated_at = NOW()
WHERE listing_id = @listing_id
RETURNING *;

-- name: PublishMarketplaceListing :one
UPDATE marketplace_listings
SET status = @status, listed_at = CASE WHEN @status::marketplace_listing_status = 'active' THEN NOW() ELSE listed_at END, updated_at = NOW()
WHERE listing_id = @listing_id
RETURNING *;

-- name: RejectMarketplaceListing :one
UPDATE marketplace_listings
SET status = 'draft', rejection_note = @rejection_note, updated_at = NOW()
WHERE listing_id = @listing_id AND status = 'pending_review'
RETURNING *;

-- name: SuspendMarketplaceListing :one
UPDATE marketplace_listings
SET status = 'suspended', suspension_note = @suspension_note, updated_at = NOW()
WHERE listing_id = @listing_id AND status = 'active'
RETURNING *;

-- name: ReinstateMarketplaceListing :one
UPDATE marketplace_listings
SET status = 'active', suspension_note = NULL, updated_at = NOW()
WHERE listing_id = @listing_id AND status = 'suspended'
RETURNING *;

-- name: ArchiveMarketplaceListing :one
UPDATE marketplace_listings
SET status = 'archived', updated_at = NOW()
WHERE listing_id = @listing_id AND status IN ('active','suspended')
RETURNING *;

-- name: ReopenMarketplaceListing :one
UPDATE marketplace_listings
SET status = 'draft', updated_at = NOW()
WHERE listing_id = @listing_id AND status = 'archived'
RETURNING *;

-- name: CountActiveOrPendingListingsForOrg :one
SELECT COUNT(*)::int FROM marketplace_listings
WHERE org_id = @org_id AND status IN ('active','pending_review');

-- Marketplace: listing capabilities

-- name: AddListingCapability :exec
INSERT INTO marketplace_listing_capabilities (listing_id, capability_id)
VALUES (@listing_id, @capability_id)
ON CONFLICT (listing_id, capability_id) DO UPDATE SET removed_at = NULL;

-- name: RemoveListingCapability :exec
UPDATE marketplace_listing_capabilities
SET removed_at = NOW()
WHERE listing_id = @listing_id AND capability_id = @capability_id;

-- name: ListCurrentCapabilitiesForListing :many
SELECT capability_id FROM marketplace_listing_capabilities
WHERE listing_id = @listing_id AND removed_at IS NULL
ORDER BY capability_id;

-- name: CountCurrentCapabilitiesForListing :one
SELECT COUNT(*)::int FROM marketplace_listing_capabilities
WHERE listing_id = @listing_id AND removed_at IS NULL;

-- Marketplace: subscriptions

-- name: GetMarketplaceSubscription :one
SELECT * FROM marketplace_subscriptions
WHERE consumer_org_id = @consumer_org_id AND listing_id = @listing_id;

-- name: GetMarketplaceSubscriptionByID :one
SELECT * FROM marketplace_subscriptions WHERE subscription_id = @subscription_id;

-- name: UpsertMarketplaceSubscription :one
INSERT INTO marketplace_subscriptions (subscription_id, listing_id, consumer_org_id, consumer_org_domain, provider_org_id, provider_org_domain, provider_listing_number, request_note, status, started_at)
VALUES (gen_random_uuid(), @listing_id, @consumer_org_id, @consumer_org_domain, @provider_org_id, @provider_org_domain, @provider_listing_number, @request_note, 'active', NOW())
ON CONFLICT (consumer_org_id, listing_id) DO UPDATE
SET status = 'active', started_at = NOW(), request_note = EXCLUDED.request_note, updated_at = NOW(), cancelled_at = NULL, expires_at = NULL
RETURNING *;

-- name: CancelMarketplaceSubscription :one
UPDATE marketplace_subscriptions
SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
WHERE subscription_id = @subscription_id AND status = 'active'
RETURNING *;

-- name: ListMarketplaceSubscriptionsByConsumer :many
SELECT * FROM marketplace_subscriptions
WHERE consumer_org_id = @consumer_org_id
  AND (sqlc.narg('filter_status')::marketplace_subscription_status IS NULL OR status = sqlc.narg('filter_status')::marketplace_subscription_status)
  AND (sqlc.narg('pagination_key')::uuid IS NULL OR subscription_id > sqlc.narg('pagination_key')::uuid)
ORDER BY subscription_id ASC
LIMIT @row_limit;

-- name: HasActiveSubscriptionForListing :one
SELECT EXISTS(
    SELECT 1 FROM marketplace_subscriptions
    WHERE consumer_org_id = @consumer_org_id AND listing_id = @listing_id AND status = 'active'
) AS is_subscribed;

-- name: GetMyListingStatus :one
SELECT
    EXISTS(SELECT 1 FROM marketplace_listings ml WHERE ml.listing_id = @param_listing_id AND ml.org_id = @param_org_id) AS is_owner,
    EXISTS(SELECT 1 FROM marketplace_subscriptions ms WHERE ms.listing_id = @param_listing_id AND ms.consumer_org_id = @param_org_id AND ms.status = 'active') AS is_subscribed;
