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

-- ============================================
-- Org User Queries (Regional)
-- ============================================

-- name: GetOrgUserByEmail :one
SELECT * FROM org_users WHERE email_address = $1;

-- name: GetOrgUserByID :one
SELECT * FROM org_users WHERE org_user_id = $1;

-- name: CreateOrgUser :one
INSERT INTO org_users (org_user_id, email_address, password_hash)
VALUES ($1, $2, $3)
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
