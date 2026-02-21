-- +goose Up

-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Region enum
CREATE TYPE region AS ENUM (
    'ind1',
    'usa1',
    'deu1',
    'sgp1'
);

-- Email address hashing algorithm enum
CREATE TYPE email_address_hashing_algorithm AS ENUM (
    'SHA-256'
);

-- Admin user status enum
CREATE TYPE admin_user_status AS ENUM (
    'invited',
    'active',
    'disabled'
);

-- Domain status enum
CREATE TYPE domain_status AS ENUM ('active', 'inactive');

-- Hub users table (global - routing only)
CREATE TABLE hub_users (
    hub_user_global_id UUID PRIMARY KEY NOT NULL,
    handle TEXT NOT NULL UNIQUE,
    email_address_hash BYTEA NOT NULL UNIQUE,
    hashing_algorithm email_address_hashing_algorithm NOT NULL,
    home_region region NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Admin users table (global only - admins are platform-wide, not regional)
CREATE TABLE admin_users (
    admin_user_id UUID PRIMARY KEY NOT NULL,
    email_address TEXT NOT NULL UNIQUE,
    full_name TEXT,
    password_hash BYTEA,
    status admin_user_status NOT NULL,
    preferred_language TEXT NOT NULL DEFAULT 'en-US',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Admin TFA tokens for email-based two-factor authentication
CREATE TABLE admin_tfa_tokens (
    tfa_token TEXT PRIMARY KEY NOT NULL,
    admin_user_id UUID NOT NULL REFERENCES admin_users(admin_user_id) ON DELETE CASCADE,
    tfa_code TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);

-- Admin sessions
CREATE TABLE admin_sessions (
    session_token TEXT PRIMARY KEY NOT NULL,
    admin_user_id UUID NOT NULL REFERENCES admin_users(admin_user_id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);

-- Admin invitation tokens for user invitations
CREATE TABLE admin_invitation_tokens (
    invitation_token TEXT PRIMARY KEY NOT NULL,
    admin_user_id UUID NOT NULL REFERENCES admin_users(admin_user_id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);

-- Admin password reset tokens
CREATE TABLE admin_password_reset_tokens (
    reset_token TEXT PRIMARY KEY NOT NULL,
    admin_user_id UUID NOT NULL REFERENCES admin_users(admin_user_id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);

-- Supported languages table for UI dropdowns
CREATE TABLE supported_languages (
    language_code TEXT PRIMARY KEY,
    language_name TEXT NOT NULL,
    native_name TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Ensure only one default language
CREATE UNIQUE INDEX idx_supported_languages_default
ON supported_languages (is_default)
WHERE is_default = TRUE;

-- Initial supported languages
INSERT INTO supported_languages (language_code, language_name, native_name, is_default) VALUES
    ('en-US', 'English (United States)', 'English', TRUE),
    ('de-DE', 'German (Germany)', 'Deutsch', FALSE),
    ('ta-IN', 'Tamil (India)', 'தமிழ்', FALSE);

-- Approved domains table
CREATE TABLE approved_domains (
    domain_id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    domain_name VARCHAR(255) NOT NULL UNIQUE,
    status domain_status NOT NULL DEFAULT 'active',
    created_by_admin_id UUID NOT NULL REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Trigger for approved_domains updated_at
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION update_approved_domains_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER approved_domains_updated_at
    BEFORE UPDATE ON approved_domains
    FOR EACH ROW
    EXECUTE FUNCTION update_approved_domains_updated_at();

-- Audit log for approved domains management
CREATE TABLE approved_domains_audit_log (
    audit_id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES admin_users(admin_user_id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    target_domain_id UUID REFERENCES approved_domains(domain_id) ON DELETE SET NULL,
    target_domain_name VARCHAR(255),
    old_value JSONB,
    new_value JSONB,
    reason VARCHAR(256),
    ip_address INET,
    user_agent TEXT,
    request_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Hub signup tokens
CREATE TABLE hub_signup_tokens (
    signup_token TEXT PRIMARY KEY NOT NULL,
    email_address TEXT NOT NULL,
    email_address_hash BYTEA NOT NULL,
    hashing_algorithm email_address_hashing_algorithm NOT NULL DEFAULT 'SHA-256',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP
);

-- Hub user display names
CREATE TABLE hub_user_display_names (
    hub_user_global_id UUID NOT NULL REFERENCES hub_users(hub_user_global_id) ON DELETE CASCADE,
    language_code TEXT NOT NULL,
    display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
    is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (hub_user_global_id, language_code)
);

-- Available regions
CREATE TABLE available_regions (
    region_code region PRIMARY KEY,
    region_name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO available_regions (region_code, region_name, is_active) VALUES
    ('ind1', 'India - Chennai', TRUE),
    ('usa1', 'USA - California', TRUE),
    ('deu1', 'Germany - Frankfurt', TRUE),
    ('sgp1', 'Singapore', FALSE);

-- Employers table (global - for cross-region uniqueness and routing)
CREATE TABLE employers (
    employer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employer_name TEXT NOT NULL,
    region region NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Global employer domains table (for cross-region uniqueness and routing)
-- Per spec section 3.4: ensures domain is claimed by ONLY ONE region/employer
CREATE TABLE global_employer_domains (
    domain TEXT PRIMARY KEY,
    region region NOT NULL,
    employer_id UUID NOT NULL REFERENCES employers(employer_id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Org users table (global - routing only)
-- Note: email_address_hash is NOT unique alone - one email can belong to multiple employers
-- (contractor scenario). Uniqueness is enforced per (email_address_hash, employer_id).
CREATE TABLE org_users (
    org_user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_address_hash BYTEA NOT NULL,
    hashing_algorithm email_address_hashing_algorithm NOT NULL DEFAULT 'SHA-256',
    employer_id UUID NOT NULL REFERENCES employers(employer_id) ON DELETE CASCADE,
    home_region region NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (email_address_hash, employer_id)
);

-- Org signup tokens (global - for DNS-based signup verification)
-- signup_token: DNS verification token (goes in TXT record, public)
-- email_token: Secret token sent via email only (proves email access)
CREATE TABLE org_signup_tokens (
    signup_token TEXT PRIMARY KEY NOT NULL,
    email_token TEXT NOT NULL UNIQUE,
    email_address TEXT NOT NULL,
    email_address_hash BYTEA NOT NULL,
    hashing_algorithm email_address_hashing_algorithm NOT NULL DEFAULT 'SHA-256',
    domain TEXT NOT NULL,
    home_region region NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP
);

-- Agencies table (global - for cross-region uniqueness and routing)
CREATE TABLE agencies (
    agency_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_name TEXT NOT NULL,
    region region NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Global agency domains table (for cross-region uniqueness and routing)
-- Ensures domain is claimed by ONLY ONE region/agency
CREATE TABLE global_agency_domains (
    domain TEXT PRIMARY KEY,
    region region NOT NULL,
    agency_id UUID NOT NULL REFERENCES agencies(agency_id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Agency users table (global - routing only)
-- Note: email_address_hash is NOT unique alone - one email can belong to multiple agencies
-- (contractor scenario). Uniqueness is enforced per (email_address_hash, agency_id).
CREATE TABLE agency_users (
    agency_user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_address_hash BYTEA NOT NULL,
    hashing_algorithm email_address_hashing_algorithm NOT NULL DEFAULT 'SHA-256',
    agency_id UUID NOT NULL REFERENCES agencies(agency_id) ON DELETE CASCADE,
    home_region region NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (email_address_hash, agency_id)
);

-- Agency signup tokens (global - for DNS-based signup verification)
-- signup_token: DNS verification token (goes in TXT record, public)
-- email_token: Secret token sent via email only (proves email access)
CREATE TABLE agency_signup_tokens (
    signup_token TEXT PRIMARY KEY NOT NULL,
    email_token TEXT NOT NULL UNIQUE,
    email_address TEXT NOT NULL,
    email_address_hash BYTEA NOT NULL,
    hashing_algorithm email_address_hashing_algorithm NOT NULL DEFAULT 'SHA-256',
    domain TEXT NOT NULL,
    home_region region NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP
);

-- Email status enum (for global email queue - admin emails)
CREATE TYPE email_status AS ENUM (
    'pending',
    'sent',
    'failed',
    'cancelled'
);

-- Email template type enum (admin-only templates for global email queue)
CREATE TYPE email_template_type AS ENUM (
    'admin_tfa',
    'admin_invitation',
    'admin_password_reset'
);

-- Emails table (global email queue for admin emails)
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

-- Email delivery attempts table
CREATE TABLE email_delivery_attempts (
    attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_id UUID NOT NULL REFERENCES emails(email_id) ON DELETE CASCADE,
    attempted_at TIMESTAMP NOT NULL DEFAULT NOW(),
    error_message TEXT
);

-- RBAC: Roles table
CREATE TABLE roles (
    role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- RBAC: Admin user roles
CREATE TABLE admin_user_roles (
    admin_user_id UUID NOT NULL REFERENCES admin_users(admin_user_id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
    assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (admin_user_id, role_id)
);

-- Insert predefined roles
INSERT INTO roles (role_name, description) VALUES
    -- Admin portal roles
    ('admin:superadmin', 'Superadmin for the admin portal with full access to all operations'),
    ('admin:invite_users', 'Can invite new admin users'),
    ('admin:manage_users', 'Can enable/disable admin users and manage roles'),
    ('admin:manage_domains', 'Can manage approved domains'),

    -- Employer portal roles
    ('employer:invite_users', 'Can invite new employer users'),
    ('employer:manage_users', 'Can enable/disable employer users'),

    -- Agency portal roles
    ('agency:invite_users', 'Can invite new agency users'),
    ('agency:manage_users', 'Can enable/disable agency users');

-- Indexes
CREATE INDEX idx_admin_tfa_tokens_expires_at ON admin_tfa_tokens(expires_at);
CREATE INDEX idx_admin_sessions_expires_at ON admin_sessions(expires_at);
CREATE INDEX idx_admin_invitation_tokens_expires_at ON admin_invitation_tokens(expires_at);
CREATE INDEX idx_admin_password_reset_tokens_expires_at ON admin_password_reset_tokens(expires_at);
CREATE INDEX idx_hub_signup_tokens_expires_at ON hub_signup_tokens(expires_at);
CREATE INDEX idx_hub_signup_tokens_email_hash ON hub_signup_tokens(email_address_hash);
CREATE UNIQUE INDEX idx_hub_user_display_names_preferred
ON hub_user_display_names (hub_user_global_id) WHERE is_preferred = TRUE;
CREATE INDEX idx_org_signup_tokens_expires_at ON org_signup_tokens(expires_at);
CREATE INDEX idx_org_signup_tokens_email_hash ON org_signup_tokens(email_address_hash);
CREATE INDEX idx_org_signup_tokens_domain ON org_signup_tokens(domain);
CREATE INDEX idx_org_users_employer_id ON org_users(employer_id);
CREATE INDEX idx_org_users_email_hash ON org_users(email_address_hash);
CREATE INDEX idx_global_employer_domains_employer_id ON global_employer_domains(employer_id);
CREATE INDEX idx_agency_signup_tokens_expires_at ON agency_signup_tokens(expires_at);
CREATE INDEX idx_agency_signup_tokens_email_hash ON agency_signup_tokens(email_address_hash);
CREATE INDEX idx_agency_signup_tokens_domain ON agency_signup_tokens(domain);
CREATE INDEX idx_agency_users_agency_id ON agency_users(agency_id);
CREATE INDEX idx_agency_users_email_hash ON agency_users(email_address_hash);
CREATE INDEX idx_global_agency_domains_agency_id ON global_agency_domains(agency_id);

-- +goose Down
DROP TABLE IF EXISTS admin_user_roles;
DROP TABLE IF EXISTS roles;
DROP INDEX IF EXISTS idx_global_agency_domains_agency_id;
DROP INDEX IF EXISTS idx_agency_users_email_hash;
DROP INDEX IF EXISTS idx_agency_users_agency_id;
DROP INDEX IF EXISTS idx_agency_signup_tokens_domain;
DROP INDEX IF EXISTS idx_agency_signup_tokens_email_hash;
DROP INDEX IF EXISTS idx_agency_signup_tokens_expires_at;
DROP INDEX IF EXISTS idx_global_employer_domains_employer_id;
DROP INDEX IF EXISTS idx_org_users_email_hash;
DROP INDEX IF EXISTS idx_org_users_employer_id;
DROP INDEX IF EXISTS idx_org_signup_tokens_domain;
DROP INDEX IF EXISTS idx_org_signup_tokens_email_hash;
DROP INDEX IF EXISTS idx_org_signup_tokens_expires_at;
DROP INDEX IF EXISTS idx_hub_user_display_names_preferred;
DROP INDEX IF EXISTS idx_hub_signup_tokens_email_hash;
DROP INDEX IF EXISTS idx_hub_signup_tokens_expires_at;
DROP INDEX IF EXISTS idx_admin_password_reset_tokens_expires_at;
DROP INDEX IF EXISTS idx_admin_invitation_tokens_expires_at;
DROP INDEX IF EXISTS idx_admin_sessions_expires_at;
DROP INDEX IF EXISTS idx_admin_tfa_tokens_expires_at;
DROP TABLE IF EXISTS agency_signup_tokens;
DROP TABLE IF EXISTS agency_users;
DROP TABLE IF EXISTS global_agency_domains;
DROP TABLE IF EXISTS agencies;
DROP TABLE IF EXISTS org_signup_tokens;
DROP TABLE IF EXISTS org_users;
DROP TABLE IF EXISTS global_employer_domains;
DROP TABLE IF EXISTS employers;
DROP TABLE IF EXISTS available_regions;
DROP TABLE IF EXISTS hub_user_display_names;
DROP TABLE IF EXISTS hub_signup_tokens;
DROP TABLE IF EXISTS approved_domains_audit_log;
DROP TRIGGER IF EXISTS approved_domains_updated_at ON approved_domains;
DROP FUNCTION IF EXISTS update_approved_domains_updated_at();
DROP TABLE IF EXISTS approved_domains;
DROP TABLE IF EXISTS supported_languages;
DROP TABLE IF EXISTS admin_password_reset_tokens;
DROP TABLE IF EXISTS admin_invitation_tokens;
DROP TABLE IF EXISTS admin_sessions;
DROP TABLE IF EXISTS admin_tfa_tokens;
DROP TABLE IF EXISTS admin_users;
DROP TABLE IF EXISTS hub_users;
DROP TABLE IF EXISTS email_delivery_attempts;
DROP TABLE IF EXISTS emails;
DROP TYPE IF EXISTS email_template_type;
DROP TYPE IF EXISTS email_status;
DROP TYPE IF EXISTS domain_status;
DROP TYPE IF EXISTS admin_user_status;
DROP TYPE IF EXISTS email_address_hashing_algorithm;
DROP TYPE IF EXISTS region;
DROP EXTENSION IF EXISTS pg_trgm;
