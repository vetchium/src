-- name: Ping :one
SELECT 1 AS ping;

-- name: GetHubUserByEmail :one
SELECT * FROM hub_users WHERE email_address = $1;

-- name: GetHubUserByGlobalID :one
SELECT * FROM hub_users WHERE hub_user_global_id = $1;

-- name: CreateHubUser :one
INSERT INTO hub_users (hub_user_global_id, email_address, password_hash)
VALUES ($1, $2, $3)
RETURNING *;

-- name: DeleteHubUser :exec
DELETE FROM hub_users WHERE hub_user_global_id = $1;

-- name: UpdateHubUserPassword :exec
UPDATE hub_users SET password_hash = $2 WHERE hub_user_global_id = $1;

-- name: DeleteAllHubSessionsForUser :exec
DELETE FROM hub_sessions WHERE hub_user_global_id = $1;

-- name: DeleteAllHubSessionsExceptCurrent :exec
DELETE FROM hub_sessions WHERE hub_user_global_id = $1 AND session_token != $2;

-- Hub TFA token queries

-- name: CreateHubTFAToken :exec
INSERT INTO hub_tfa_tokens (tfa_token, hub_user_global_id, tfa_code, expires_at)
VALUES ($1, $2, $3, $4);

-- name: GetHubTFAToken :one
SELECT * FROM hub_tfa_tokens WHERE tfa_token = $1 AND expires_at > NOW();

-- name: DeleteHubTFAToken :exec
DELETE FROM hub_tfa_tokens WHERE tfa_token = $1;

-- name: DeleteExpiredHubTFATokens :exec
DELETE FROM hub_tfa_tokens WHERE expires_at <= NOW();

-- Hub session queries

-- name: CreateHubSession :exec
INSERT INTO hub_sessions (session_token, hub_user_global_id, expires_at)
VALUES ($1, $2, $3);

-- name: GetHubSession :one
SELECT * FROM hub_sessions WHERE session_token = $1 AND expires_at > NOW();

-- name: DeleteHubSession :exec
DELETE FROM hub_sessions WHERE session_token = $1;

-- name: DeleteExpiredHubSessions :exec
DELETE FROM hub_sessions WHERE expires_at <= NOW();

-- Hub password reset token queries

-- name: CreateHubPasswordResetToken :exec
INSERT INTO hub_password_reset_tokens (reset_token, hub_user_global_id, expires_at)
VALUES ($1, $2, $3);

-- name: GetHubPasswordResetToken :one
SELECT * FROM hub_password_reset_tokens WHERE reset_token = $1 AND expires_at > NOW();

-- name: DeleteHubPasswordResetToken :exec
DELETE FROM hub_password_reset_tokens WHERE reset_token = $1;

-- name: DeleteExpiredHubPasswordResetTokens :exec
DELETE FROM hub_password_reset_tokens WHERE expires_at <= NOW();

-- ============================================
-- Org User Queries (Regional)
-- ============================================

-- name: GetOrgUserByEmail :one
-- Note: This returns ONE user but may fail if email exists for multiple employers.
-- Prefer GetOrgUserByEmailAndEmployer for login flows.
SELECT * FROM org_users WHERE email_address = $1;

-- name: GetOrgUserByEmailAndEmployer :one
-- Composite lookup for login flow - email + employer uniquely identifies user
SELECT * FROM org_users
WHERE email_address = $1 AND employer_id = $2;

-- name: GetOrgUserByID :one
SELECT * FROM org_users WHERE org_user_id = $1;

-- name: CreateOrgUser :one
INSERT INTO org_users (org_user_id, email_address, employer_id, full_name, password_hash)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: DeleteOrgUser :exec
DELETE FROM org_users WHERE org_user_id = $1;

-- ============================================
-- Org TFA Token Queries
-- ============================================

-- name: CreateOrgTFAToken :exec
INSERT INTO org_tfa_tokens (tfa_token, org_user_id, tfa_code, expires_at)
VALUES ($1, $2, $3, $4);

-- name: GetOrgTFAToken :one
SELECT * FROM org_tfa_tokens WHERE tfa_token = $1 AND expires_at > NOW();

-- name: DeleteOrgTFAToken :exec
DELETE FROM org_tfa_tokens WHERE tfa_token = $1;

-- name: DeleteExpiredOrgTFATokens :exec
DELETE FROM org_tfa_tokens WHERE expires_at <= NOW();

-- ============================================
-- Org Session Queries
-- ============================================

-- name: CreateOrgSession :exec
INSERT INTO org_sessions (session_token, org_user_id, expires_at)
VALUES ($1, $2, $3);

-- name: GetOrgSession :one
SELECT * FROM org_sessions WHERE session_token = $1 AND expires_at > NOW();

-- name: DeleteOrgSession :exec
DELETE FROM org_sessions WHERE session_token = $1;

-- name: DeleteExpiredOrgSessions :exec
DELETE FROM org_sessions WHERE expires_at <= NOW();

-- name: DeleteAllOrgSessionsForUser :exec
DELETE FROM org_sessions WHERE org_user_id = $1;

-- name: DeleteAllOrgSessionsExceptCurrent :exec
DELETE FROM org_sessions WHERE org_user_id = $1 AND session_token != $2;

-- ============================================
-- Org Invitation Token Queries
-- ============================================

-- name: CreateOrgInvitationToken :exec
INSERT INTO org_invitation_tokens (invitation_token, org_user_id, employer_id, expires_at)
VALUES ($1, $2, $3, $4);

-- name: GetOrgInvitationToken :one
SELECT * FROM org_invitation_tokens WHERE invitation_token = $1 AND expires_at > NOW();

-- name: DeleteOrgInvitationToken :exec
DELETE FROM org_invitation_tokens WHERE invitation_token = $1;

-- name: DeleteExpiredOrgInvitationTokens :exec
DELETE FROM org_invitation_tokens WHERE expires_at <= NOW();

-- name: UpdateOrgUserSetup :exec
UPDATE org_users SET password_hash = $2, full_name = $3, authentication_type = $4
WHERE org_user_id = $1;

-- ============================================
-- Employer Domain Queries (Regional)
-- ============================================

-- name: CreateEmployerDomain :exec
INSERT INTO employer_domains (domain, employer_id, verification_token, token_expires_at, status)
VALUES ($1, $2, $3, $4, $5);

-- name: GetEmployerDomain :one
SELECT * FROM employer_domains WHERE domain = $1;

-- name: GetEmployerDomainByEmployerAndDomain :one
SELECT * FROM employer_domains
WHERE domain = $1 AND employer_id = $2;

-- name: UpdateEmployerDomainStatus :exec
UPDATE employer_domains
SET status = $2, last_verified_at = $3, consecutive_failures = $4
WHERE domain = $1;

-- name: UpdateEmployerDomainToken :exec
UPDATE employer_domains
SET verification_token = $2, token_expires_at = $3
WHERE domain = $1;

-- name: DeleteEmployerDomain :exec
DELETE FROM employer_domains WHERE domain = $1;

-- name: GetEmployerDomainsByEmployer :many
SELECT * FROM employer_domains
WHERE employer_id = $1
ORDER BY domain ASC;

-- name: IncrementEmployerDomainFailures :exec
UPDATE employer_domains
SET consecutive_failures = consecutive_failures + 1
WHERE domain = $1;

-- name: ResetEmployerDomainFailures :exec
UPDATE employer_domains
SET consecutive_failures = 0, last_verified_at = NOW()
WHERE domain = $1;

-- ============================================
-- Agency User Queries (Regional)
-- ============================================

-- name: GetAgencyUserByEmail :one
-- Note: This returns ONE user but may fail if email exists for multiple agencies.
-- Prefer GetAgencyUserByEmailAndAgency for login flows.
SELECT * FROM agency_users WHERE email_address = $1;

-- name: GetAgencyUserByEmailAndAgency :one
-- Composite lookup for login flow - email + agency uniquely identifies user
SELECT * FROM agency_users
WHERE email_address = $1 AND agency_id = $2;

-- name: GetAgencyUserByID :one
SELECT * FROM agency_users WHERE agency_user_id = $1;

-- name: CreateAgencyUser :one
INSERT INTO agency_users (agency_user_id, email_address, agency_id, full_name, password_hash)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: DeleteAgencyUser :exec
DELETE FROM agency_users WHERE agency_user_id = $1;

-- ============================================
-- Agency TFA Token Queries
-- ============================================

-- name: CreateAgencyTFAToken :exec
INSERT INTO agency_tfa_tokens (tfa_token, agency_user_id, tfa_code, expires_at)
VALUES ($1, $2, $3, $4);

-- name: GetAgencyTFAToken :one
SELECT * FROM agency_tfa_tokens WHERE tfa_token = $1 AND expires_at > NOW();

-- name: DeleteAgencyTFAToken :exec
DELETE FROM agency_tfa_tokens WHERE tfa_token = $1;

-- name: DeleteExpiredAgencyTFATokens :exec
DELETE FROM agency_tfa_tokens WHERE expires_at <= NOW();

-- ============================================
-- Agency Session Queries
-- ============================================

-- name: CreateAgencySession :exec
INSERT INTO agency_sessions (session_token, agency_user_id, expires_at)
VALUES ($1, $2, $3);

-- name: GetAgencySession :one
SELECT * FROM agency_sessions WHERE session_token = $1 AND expires_at > NOW();

-- name: DeleteAgencySession :exec
DELETE FROM agency_sessions WHERE session_token = $1;

-- name: DeleteExpiredAgencySessions :exec
DELETE FROM agency_sessions WHERE expires_at <= NOW();

-- name: DeleteAllAgencySessionsForUser :exec
DELETE FROM agency_sessions WHERE agency_user_id = $1;

-- ============================================
-- Hub Email Verification Token Queries
-- ============================================

-- name: CreateHubEmailVerificationToken :exec
INSERT INTO hub_email_verification_tokens (verification_token, hub_user_global_id, new_email_address, expires_at)
VALUES ($1, $2, $3, $4);

-- name: GetHubEmailVerificationToken :one
SELECT * FROM hub_email_verification_tokens WHERE verification_token = $1 AND expires_at > NOW();

-- name: DeleteHubEmailVerificationToken :exec
DELETE FROM hub_email_verification_tokens WHERE verification_token = $1;

-- name: DeleteExpiredHubEmailVerificationTokens :exec
DELETE FROM hub_email_verification_tokens WHERE expires_at <= NOW();

-- name: UpdateHubUserEmailAddress :exec
UPDATE hub_users SET email_address = $2 WHERE hub_user_global_id = $1;

-- ============================================
-- Agency Invitation Token Queries
-- ============================================

-- name: CreateAgencyInvitationToken :exec
INSERT INTO agency_invitation_tokens (invitation_token, agency_user_id, agency_id, expires_at)
VALUES ($1, $2, $3, $4);

-- name: GetAgencyInvitationToken :one
SELECT * FROM agency_invitation_tokens WHERE invitation_token = $1 AND expires_at > NOW();

-- name: DeleteAgencyInvitationToken :exec
DELETE FROM agency_invitation_tokens WHERE invitation_token = $1;

-- name: DeleteExpiredAgencyInvitationTokens :exec
DELETE FROM agency_invitation_tokens WHERE expires_at <= NOW();

-- name: UpdateAgencyUserSetup :exec
UPDATE agency_users
SET password_hash = $2, full_name = $3, authentication_type = $4
WHERE agency_user_id = $1;
