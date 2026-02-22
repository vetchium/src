-- +goose Up
-- Email status enum
CREATE TYPE email_status AS ENUM (
    'pending',
    'sent',
    'failed',
    'cancelled'
);
-- Email template type enum
CREATE TYPE email_template_type AS ENUM (
    'admin_tfa',
    'admin_invitation',
    'admin_password_reset',
    'hub_signup_verification',
    'hub_tfa',
    'hub_password_reset',
    'hub_email_verification',
    'org_signup_verification',
    'org_signup_token',
    'org_tfa',
    'org_invitation',
    'org_password_reset',
    'agency_signup_verification',
    'agency_signup_token',
    'agency_tfa',
    'agency_invitation',
    'agency_password_reset'
);
-- Authentication type enum (extensible for future SSO, hardware tokens, etc.)
CREATE TYPE authentication_type AS ENUM (
    'email_password',
    'sso_oauth',
    'sso_saml',
    'hardware_token'
);

-- Hub user status enum
CREATE TYPE hub_user_status AS ENUM (
    'active',
    'disabled',
    'deleted'
);

-- Org user status enum
CREATE TYPE org_user_status AS ENUM (
    'invited',
    'active',
    'disabled'
);

-- Agency user status enum
CREATE TYPE agency_user_status AS ENUM (
    'invited',
    'active',
    'disabled'
);
-- Domain verification status enum
CREATE TYPE domain_verification_status AS ENUM ('PENDING', 'VERIFIED', 'FAILING');
-- Hub users table (regional - all mutable data)
-- Uses hub_user_global_id as primary key (same ID as global DB for simplicity)
CREATE TABLE hub_users (
    hub_user_global_id UUID PRIMARY KEY,
    email_address TEXT NOT NULL UNIQUE,
    handle TEXT NOT NULL,
    password_hash BYTEA,
    status hub_user_status NOT NULL DEFAULT 'active',
    preferred_language TEXT NOT NULL DEFAULT 'en-US',
    resident_country_code TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
-- Emails table for transactional outbox pattern
CREATE TABLE emails (
    email_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_type email_template_type NOT NULL,
    email_to TEXT NOT NULL,
    email_subject TEXT NOT NULL,
    email_text_body TEXT NOT NULL,
    email_html_body TEXT NOT NULL,
    email_status email_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMP
);
-- Email delivery attempts
CREATE TABLE email_delivery_attempts (
    attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_id UUID NOT NULL REFERENCES emails(email_id) ON DELETE CASCADE,
    attempted_at TIMESTAMP NOT NULL DEFAULT NOW(),
    error_message TEXT
);
-- Hub TFA tokens for email-based two-factor authentication
CREATE TABLE hub_tfa_tokens (
    tfa_token TEXT PRIMARY KEY NOT NULL,
    hub_user_global_id UUID NOT NULL REFERENCES hub_users(hub_user_global_id) ON DELETE CASCADE,
    tfa_code TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);
-- Hub sessions (regional storage for data sovereignty)
CREATE TABLE hub_sessions (
    session_token TEXT PRIMARY KEY NOT NULL,
    hub_user_global_id UUID NOT NULL REFERENCES hub_users(hub_user_global_id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);
-- Hub password reset tokens
CREATE TABLE hub_password_reset_tokens (
    reset_token TEXT PRIMARY KEY NOT NULL,
    hub_user_global_id UUID NOT NULL REFERENCES hub_users(hub_user_global_id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);
-- Hub email verification tokens
CREATE TABLE hub_email_verification_tokens (
    verification_token TEXT PRIMARY KEY NOT NULL,
    hub_user_global_id UUID NOT NULL REFERENCES hub_users(hub_user_global_id) ON DELETE CASCADE,
    new_email_address TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);
-- Org users table (regional - stores credentials, PII, and all mutable data)
-- Note: email_address is NOT unique alone - one email can belong to multiple employers
-- (contractor scenario). Uniqueness is enforced per (email_address, employer_id).
CREATE TABLE org_users (
    org_user_id UUID PRIMARY KEY,
    email_address TEXT NOT NULL,
    employer_id UUID NOT NULL,
    full_name TEXT,
    password_hash BYTEA,
    authentication_type authentication_type NOT NULL DEFAULT 'email_password',
    status org_user_status NOT NULL DEFAULT 'active',
    preferred_language TEXT NOT NULL DEFAULT 'en-US',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (email_address, employer_id)
);
-- Org TFA tokens for email-based two-factor authentication
CREATE TABLE org_tfa_tokens (
    tfa_token TEXT PRIMARY KEY NOT NULL,
    org_user_id UUID NOT NULL REFERENCES org_users(org_user_id) ON DELETE CASCADE,
    tfa_code TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);
-- Org sessions (regional storage for data sovereignty)
CREATE TABLE org_sessions (
    session_token TEXT PRIMARY KEY NOT NULL,
    org_user_id UUID NOT NULL REFERENCES org_users(org_user_id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);
-- Org password reset tokens
CREATE TABLE org_password_reset_tokens (
    reset_token TEXT PRIMARY KEY NOT NULL,
    org_user_global_id UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);
-- Org invitation tokens for user invitations
CREATE TABLE org_invitation_tokens (
    invitation_token TEXT PRIMARY KEY NOT NULL,
    org_user_id UUID NOT NULL REFERENCES org_users(org_user_id) ON DELETE CASCADE,
    employer_id UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);
-- Employer domains table (regional - stores operational data)
-- Per spec section 3.4: stores tokens, audit logs, and cron-job state
CREATE TABLE employer_domains (
    domain TEXT PRIMARY KEY,
    employer_id UUID NOT NULL,
    verification_token TEXT NOT NULL,
    token_expires_at TIMESTAMP NOT NULL,
    last_verified_at TIMESTAMP,
    last_verification_requested_at TIMESTAMP,
    consecutive_failures INT NOT NULL DEFAULT 0,
    status domain_verification_status NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
-- Agency domains table (regional - stores operational data)
-- Per spec section 3.4: stores tokens, audit logs, and cron-job state
CREATE TABLE agency_domains (
    domain TEXT PRIMARY KEY,
    agency_id UUID NOT NULL,
    verification_token TEXT NOT NULL,
    token_expires_at TIMESTAMP NOT NULL,
    last_verified_at TIMESTAMP,
    last_verification_requested_at TIMESTAMP,
    consecutive_failures INT NOT NULL DEFAULT 0,
    status domain_verification_status NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
-- Agency users table (regional - stores credentials, PII, and all mutable data)
-- Note: email_address is NOT unique alone - one email can belong to multiple agencies
-- (contractor scenario). Uniqueness is enforced per (email_address, agency_id).
CREATE TABLE agency_users (
    agency_user_id UUID PRIMARY KEY,
    email_address TEXT NOT NULL,
    agency_id UUID NOT NULL,
    full_name TEXT,
    password_hash BYTEA,
    authentication_type authentication_type NOT NULL DEFAULT 'email_password',
    status agency_user_status NOT NULL DEFAULT 'active',
    preferred_language TEXT NOT NULL DEFAULT 'en-US',
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (email_address, agency_id)
);
-- Agency TFA tokens for email-based two-factor authentication
CREATE TABLE agency_tfa_tokens (
    tfa_token TEXT PRIMARY KEY NOT NULL,
    agency_user_id UUID NOT NULL REFERENCES agency_users(agency_user_id) ON DELETE CASCADE,
    tfa_code TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);
-- Agency sessions (regional storage for data sovereignty)
CREATE TABLE agency_sessions (
    session_token TEXT PRIMARY KEY NOT NULL,
    agency_user_id UUID NOT NULL REFERENCES agency_users(agency_user_id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);
-- Agency password reset tokens
CREATE TABLE agency_password_reset_tokens (
    reset_token TEXT PRIMARY KEY NOT NULL,
    agency_user_global_id UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);
-- Agency invitation tokens for user invitations
CREATE TABLE agency_invitation_tokens (
    invitation_token TEXT PRIMARY KEY NOT NULL,
    agency_user_id UUID NOT NULL REFERENCES agency_users(agency_user_id) ON DELETE CASCADE,
    agency_id UUID NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);
-- RBAC: Roles table
CREATE TABLE roles (
    role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
-- RBAC: Org user roles
CREATE TABLE org_user_roles (
    org_user_id UUID NOT NULL REFERENCES org_users(org_user_id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
    assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_user_id, role_id)
);
-- RBAC: Agency user roles
CREATE TABLE agency_user_roles (
    agency_user_id UUID NOT NULL REFERENCES agency_users(agency_user_id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
    assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (agency_user_id, role_id)
);
-- RBAC: Hub user roles
CREATE TABLE hub_user_roles (
    hub_user_global_id UUID NOT NULL REFERENCES hub_users(hub_user_global_id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
    assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (hub_user_global_id, role_id)
);
-- Insert predefined roles
INSERT INTO roles (role_name, description) VALUES
    -- Admin portal roles
    ('admin:superadmin', 'Superadmin for the admin portal with full access to all operations'),
    ('admin:view_users', 'Can view admin user list and details (read-only)'),
    ('admin:manage_users', 'Can invite, enable/disable admin users and manage their roles'),
    ('admin:view_domains', 'Can view approved domain list and details (read-only)'),
    ('admin:manage_domains', 'Can add, enable/disable approved domains'),

    -- Employer portal roles
    ('employer:view_users', 'Can view org user list and details (read-only)'),
    ('employer:manage_users', 'Can invite, enable/disable org users and manage their roles'),
    ('employer:view_domains', 'Can view employer domain list and status (read-only)'),
    ('employer:manage_domains', 'Can claim, verify and delete employer domains'),

    -- Agency portal roles
    ('agency:view_users', 'Can view agency user list and details (read-only)'),
    ('agency:manage_users', 'Can invite, enable/disable agency users and manage their roles'),
    ('agency:view_domains', 'Can view agency domain list and status (read-only)'),
    ('agency:manage_domains', 'Can claim, verify and delete agency domains'),

    -- Superadmin roles
    ('employer:superadmin', 'Superadmin for the employer portal with full access to all operations'),
    ('agency:superadmin', 'Superadmin for the agency portal with full access to all operations'),

    -- Hub portal roles (assigned at signup, additional roles for paid features)
    ('hub:read_posts', 'Can read posts by other hub users'),
    ('hub:write_posts', 'Can create and edit posts (paid feature)'),
    ('hub:apply_jobs', 'Can apply to job postings');
-- Indexes
CREATE INDEX idx_hub_tfa_tokens_expires_at ON hub_tfa_tokens(expires_at);
CREATE INDEX idx_hub_sessions_expires_at ON hub_sessions(expires_at);
CREATE INDEX idx_hub_sessions_hub_user_global_id ON hub_sessions(hub_user_global_id);
CREATE INDEX idx_hub_password_reset_tokens_expires_at ON hub_password_reset_tokens(expires_at);
CREATE INDEX idx_hub_email_verification_tokens_expires_at ON hub_email_verification_tokens(expires_at);
CREATE INDEX idx_org_tfa_tokens_expires_at ON org_tfa_tokens(expires_at);
CREATE INDEX idx_org_sessions_expires_at ON org_sessions(expires_at);
CREATE INDEX idx_org_sessions_org_user_id ON org_sessions(org_user_id);
CREATE INDEX idx_org_password_reset_tokens_expires_at ON org_password_reset_tokens(expires_at);
CREATE INDEX idx_org_invitation_tokens_expires_at ON org_invitation_tokens(expires_at);
CREATE INDEX idx_org_users_email_address ON org_users(email_address);
CREATE INDEX idx_org_users_employer_id ON org_users(employer_id);
CREATE INDEX idx_employer_domains_employer_id ON employer_domains(employer_id);
CREATE INDEX idx_employer_domains_status ON employer_domains(status);
CREATE INDEX idx_agency_tfa_tokens_expires_at ON agency_tfa_tokens(expires_at);
CREATE INDEX idx_agency_sessions_expires_at ON agency_sessions(expires_at);
CREATE INDEX idx_agency_sessions_agency_user_id ON agency_sessions(agency_user_id);
CREATE INDEX idx_agency_password_reset_tokens_expires_at ON agency_password_reset_tokens(expires_at);
CREATE INDEX idx_agency_invitation_tokens_expires_at ON agency_invitation_tokens(expires_at);
CREATE INDEX idx_agency_users_email_address ON agency_users(email_address);
CREATE INDEX idx_agency_users_agency_id ON agency_users(agency_id);
CREATE INDEX idx_agency_domains_agency_id ON agency_domains(agency_id);
CREATE INDEX idx_agency_domains_status ON agency_domains(status);
-- +goose Down
DROP INDEX IF EXISTS idx_agency_domains_status;
DROP INDEX IF EXISTS idx_agency_domains_agency_id;
DROP INDEX IF EXISTS idx_agency_users_agency_id;
DROP INDEX IF EXISTS idx_agency_users_email_address;
DROP INDEX IF EXISTS idx_agency_invitation_tokens_expires_at;
DROP INDEX IF EXISTS idx_agency_password_reset_tokens_expires_at;
DROP INDEX IF EXISTS idx_agency_sessions_agency_user_id;
DROP INDEX IF EXISTS idx_agency_sessions_expires_at;
DROP INDEX IF EXISTS idx_agency_tfa_tokens_expires_at;
DROP INDEX IF EXISTS idx_employer_domains_status;
DROP INDEX IF EXISTS idx_employer_domains_employer_id;
DROP INDEX IF EXISTS idx_org_users_employer_id;
DROP INDEX IF EXISTS idx_org_users_email_address;
DROP INDEX IF EXISTS idx_org_invitation_tokens_expires_at;
DROP INDEX IF EXISTS idx_org_password_reset_tokens_expires_at;
DROP INDEX IF EXISTS idx_org_sessions_org_user_id;
DROP INDEX IF EXISTS idx_org_sessions_expires_at;
DROP INDEX IF EXISTS idx_org_tfa_tokens_expires_at;
DROP INDEX IF EXISTS idx_hub_email_verification_tokens_expires_at;
DROP INDEX IF EXISTS idx_hub_password_reset_tokens_expires_at;
DROP INDEX IF EXISTS idx_hub_sessions_hub_user_global_id;
DROP INDEX IF EXISTS idx_hub_sessions_expires_at;
DROP INDEX IF EXISTS idx_hub_tfa_tokens_expires_at;
DROP TABLE IF EXISTS agency_invitation_tokens;
DROP TABLE IF EXISTS agency_password_reset_tokens;
DROP TABLE IF EXISTS agency_sessions;
DROP TABLE IF EXISTS agency_tfa_tokens;
DROP TABLE IF EXISTS agency_users;
DROP TABLE IF EXISTS agency_domains;
DROP TABLE IF EXISTS employer_domains;
DROP TABLE IF EXISTS org_invitation_tokens;
DROP TABLE IF EXISTS org_password_reset_tokens;
DROP TABLE IF EXISTS org_sessions;
DROP TABLE IF EXISTS org_tfa_tokens;
DROP TABLE IF EXISTS org_users;
DROP TABLE IF EXISTS hub_user_roles;
DROP TABLE IF EXISTS hub_sessions;
DROP TABLE IF EXISTS hub_email_verification_tokens;
DROP TABLE IF EXISTS hub_password_reset_tokens;
DROP TABLE IF EXISTS hub_tfa_tokens;
DROP TABLE IF EXISTS email_delivery_attempts;
DROP TABLE IF EXISTS emails;
DROP TABLE IF EXISTS hub_users;
DROP TYPE IF EXISTS domain_verification_status;
DROP TYPE IF EXISTS agency_user_status;
DROP TYPE IF EXISTS org_user_status;
DROP TYPE IF EXISTS hub_user_status;
DROP TYPE IF EXISTS authentication_type;
DROP TYPE IF EXISTS email_template_type;
DROP TYPE IF EXISTS email_status;