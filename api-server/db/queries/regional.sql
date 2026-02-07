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
-- name: GetOrgUserByEmailAndEmployer :one
-- Composite lookup for login flow - email + employer uniquely identifies user
SELECT *
FROM org_users
WHERE email_address = $1
    AND employer_id = $2;
-- name: GetOrgUserByID :one
SELECT *
FROM org_users
WHERE org_user_id = $1;
-- name: CreateOrgUser :one
INSERT INTO org_users (
        org_user_id,
        email_address,
        employer_id,
        full_name,
        password_hash,
        status,
        preferred_language,
        is_admin
    )
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
-- name: CountOrgUsersByEmployer :one
SELECT COUNT(*)
FROM org_users
WHERE employer_id = $1;
-- name: CountActiveAdminOrgUsers :one
SELECT COUNT(*)
FROM org_users
WHERE employer_id = $1
  AND is_admin = TRUE
  AND status = 'active';
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
        employer_id,
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
-- Employer Domain Queries (Regional)
-- ============================================
-- name: CreateEmployerDomain :exec
INSERT INTO employer_domains (
        domain,
        employer_id,
        verification_token,
        token_expires_at,
        status
    )
VALUES ($1, $2, $3, $4, $5);
-- name: GetEmployerDomain :one
SELECT *
FROM employer_domains
WHERE domain = $1;
-- name: GetEmployerDomainByEmployerAndDomain :one
SELECT *
FROM employer_domains
WHERE domain = $1
    AND employer_id = $2;
-- name: UpdateEmployerDomainStatus :exec
UPDATE employer_domains
SET status = $2,
    last_verified_at = $3,
    consecutive_failures = $4
WHERE domain = $1;
-- name: UpdateEmployerDomainToken :exec
UPDATE employer_domains
SET verification_token = $2,
    token_expires_at = $3
WHERE domain = $1;
-- name: DeleteEmployerDomain :exec
DELETE FROM employer_domains
WHERE domain = $1;
-- name: GetEmployerDomainsByEmployer :many
SELECT *
FROM employer_domains
WHERE employer_id = $1
ORDER BY domain ASC;
-- name: IncrementEmployerDomainFailures :exec
UPDATE employer_domains
SET consecutive_failures = consecutive_failures + 1
WHERE domain = $1;
-- name: ResetEmployerDomainFailures :exec
UPDATE employer_domains
SET consecutive_failures = 0,
    last_verified_at = NOW()
WHERE domain = $1;
-- ============================================
-- Agency User Queries (Regional)
-- ============================================
-- name: FilterOrgUsers :many
SELECT u.org_user_id,
    u.email_address,
    u.full_name,
    u.status,
    u.is_admin,
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
WHERE u.employer_id = @employer_id
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
-- Agency Users
-- name: FilterAgencyUsers :many
SELECT u.agency_user_id,
    u.email_address,
    u.full_name,
    u.status,
    u.is_admin,
    u.created_at,
    COALESCE(
        (
            SELECT array_agg(
                    r.role_name
                    ORDER BY r.role_name
                )
            FROM agency_user_roles aur
                JOIN roles r ON aur.role_id = r.role_id
            WHERE aur.agency_user_id = u.agency_user_id
        ),
        '{}'
    )::text [] AS roles
FROM agency_users u
WHERE u.agency_id = @agency_id
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
                AND u.agency_user_id < @cursor_id
            )
        )
    )
ORDER BY u.created_at DESC,
    u.agency_user_id DESC
LIMIT @limit_count;
-- name: GetAgencyUserByEmail :one
-- Note: This returns ONE user but may fail if email exists for multiple agencies.
-- Prefer GetAgencyUserByEmailAndAgency for login flows.
SELECT *
FROM agency_users
WHERE email_address = $1;
-- name: GetAgencyUserByEmailAndAgency :one
-- Composite lookup for login flow - email + agency uniquely identifies user
SELECT *
FROM agency_users
WHERE email_address = $1
    AND agency_id = $2;
-- name: GetAgencyUserByID :one
SELECT *
FROM agency_users
WHERE agency_user_id = $1;
-- name: CreateAgencyUser :one
INSERT INTO agency_users (
        agency_user_id,
        email_address,
        agency_id,
        full_name,
        password_hash,
        status,
        preferred_language,
        is_admin
    )
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;
-- name: DeleteAgencyUser :exec
DELETE FROM agency_users
WHERE agency_user_id = $1;
-- Agency user status and preferences queries
-- name: UpdateAgencyUserStatus :exec
UPDATE agency_users
SET status = $2
WHERE agency_user_id = $1;
-- name: UpdateAgencyUserPreferredLanguage :exec
UPDATE agency_users
SET preferred_language = $2
WHERE agency_user_id = $1;
-- name: UpdateAgencyUserFullName :exec
UPDATE agency_users
SET full_name = $2,
    preferred_language = COALESCE($3, preferred_language)
WHERE agency_user_id = $1;
-- name: CountAgencyUsersByAgency :one
SELECT COUNT(*)
FROM agency_users
WHERE agency_id = $1;
-- name: CountActiveAdminAgencyUsers :one
SELECT COUNT(*)
FROM agency_users
WHERE agency_id = $1
  AND is_admin = TRUE
  AND status = 'active';
-- ============================================
-- Agency TFA Token Queries
-- ============================================
-- name: CreateAgencyTFAToken :exec
INSERT INTO agency_tfa_tokens (tfa_token, agency_user_id, tfa_code, expires_at)
VALUES ($1, $2, $3, $4);
-- name: GetAgencyTFAToken :one
SELECT *
FROM agency_tfa_tokens
WHERE tfa_token = $1
    AND expires_at > NOW();
-- name: DeleteAgencyTFAToken :exec
DELETE FROM agency_tfa_tokens
WHERE tfa_token = $1;
-- name: DeleteExpiredAgencyTFATokens :exec
DELETE FROM agency_tfa_tokens
WHERE expires_at <= NOW();
-- ============================================
-- Agency Session Queries
-- ============================================
-- name: CreateAgencySession :exec
INSERT INTO agency_sessions (session_token, agency_user_id, expires_at)
VALUES ($1, $2, $3);
-- name: GetAgencySession :one
SELECT *
FROM agency_sessions
WHERE session_token = $1
    AND expires_at > NOW();
-- name: DeleteAgencySession :exec
DELETE FROM agency_sessions
WHERE session_token = $1;
-- name: DeleteExpiredAgencySessions :exec
DELETE FROM agency_sessions
WHERE expires_at <= NOW();
-- name: DeleteAllAgencySessionsForUser :exec
DELETE FROM agency_sessions
WHERE agency_user_id = $1;
-- name: DeleteAllAgencySessionsExceptCurrent :exec
DELETE FROM agency_sessions
WHERE agency_user_id = $1
    AND session_token != $2;
-- ============================================
-- Agency Password Reset Token Queries
-- ============================================
-- name: CreateAgencyPasswordResetToken :exec
INSERT INTO agency_password_reset_tokens (reset_token, agency_user_global_id, expires_at)
VALUES ($1, $2, $3);
-- name: GetAgencyPasswordResetToken :one
SELECT *
FROM agency_password_reset_tokens
WHERE reset_token = $1
    AND expires_at > NOW();
-- name: DeleteAgencyPasswordResetToken :exec
DELETE FROM agency_password_reset_tokens
WHERE reset_token = $1;
-- name: DeleteExpiredAgencyPasswordResetTokens :exec
DELETE FROM agency_password_reset_tokens
WHERE expires_at <= NOW();
-- name: UpdateAgencyUserPassword :exec
UPDATE agency_users
SET password_hash = $2
WHERE agency_user_id = $1;
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
-- Agency Invitation Token Queries
-- ============================================
-- name: CreateAgencyInvitationToken :exec
INSERT INTO agency_invitation_tokens (
        invitation_token,
        agency_user_id,
        agency_id,
        expires_at
    )
VALUES ($1, $2, $3, $4);
-- name: GetAgencyInvitationToken :one
SELECT *
FROM agency_invitation_tokens
WHERE invitation_token = $1
    AND expires_at > NOW();
-- name: DeleteAgencyInvitationToken :exec
DELETE FROM agency_invitation_tokens
WHERE invitation_token = $1;
-- name: DeleteExpiredAgencyInvitationTokens :exec
DELETE FROM agency_invitation_tokens
WHERE expires_at <= NOW();
-- name: UpdateAgencyUserSetup :exec
UPDATE agency_users
SET password_hash = $2,
    full_name = $3,
    authentication_type = $4,
    status = $5,
    preferred_language = COALESCE($6, preferred_language)
WHERE agency_user_id = $1;
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
-- Agency user role queries
-- name: GetAgencyUserRoles :many
SELECT r.role_id,
  r.role_name,
  r.description,
  aur.assigned_at
FROM agency_user_roles aur
  JOIN roles r ON aur.role_id = r.role_id
WHERE aur.agency_user_id = $1
ORDER BY r.role_name ASC;
-- name: HasAgencyUserRole :one
SELECT EXISTS(
    SELECT 1
    FROM agency_user_roles
    WHERE agency_user_id = $1
      AND role_id = $2
  ) AS has_role;
-- name: AssignAgencyUserRole :exec
INSERT INTO agency_user_roles (agency_user_id, role_id)
VALUES ($1, $2);
-- name: RemoveAgencyUserRole :exec
DELETE FROM agency_user_roles
WHERE agency_user_id = $1
  AND role_id = $2;