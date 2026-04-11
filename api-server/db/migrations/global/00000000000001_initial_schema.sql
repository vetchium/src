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
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Admin users table (global only - admins are platform-wide, not regional)
CREATE TABLE admin_users (
    admin_user_id UUID PRIMARY KEY NOT NULL,
    email_address TEXT NOT NULL UNIQUE,
    full_name TEXT,
    password_hash BYTEA,
    status admin_user_status NOT NULL,
    preferred_language TEXT NOT NULL DEFAULT 'en-US',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Admin TFA tokens for email-based two-factor authentication
CREATE TABLE admin_tfa_tokens (
    tfa_token TEXT PRIMARY KEY NOT NULL,
    admin_user_id UUID NOT NULL REFERENCES admin_users(admin_user_id) ON DELETE CASCADE,
    tfa_code TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- Admin sessions
CREATE TABLE admin_sessions (
    session_token TEXT PRIMARY KEY NOT NULL,
    admin_user_id UUID NOT NULL REFERENCES admin_users(admin_user_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- Admin invitation tokens for user invitations
CREATE TABLE admin_invitation_tokens (
    invitation_token TEXT PRIMARY KEY NOT NULL,
    admin_user_id UUID NOT NULL REFERENCES admin_users(admin_user_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- Admin password reset tokens
CREATE TABLE admin_password_reset_tokens (
    reset_token TEXT PRIMARY KEY NOT NULL,
    admin_user_id UUID NOT NULL REFERENCES admin_users(admin_user_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- Supported languages table for UI dropdowns
CREATE TABLE supported_languages (
    language_code TEXT PRIMARY KEY,
    language_name TEXT NOT NULL,
    native_name TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

-- Hub signup tokens
CREATE TABLE hub_signup_tokens (
    signup_token TEXT PRIMARY KEY NOT NULL,
    email_address TEXT NOT NULL,
    email_address_hash BYTEA NOT NULL,
    hashing_algorithm email_address_hashing_algorithm NOT NULL DEFAULT 'SHA-256',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);

-- Hub user display names
CREATE TABLE hub_user_display_names (
    hub_user_global_id UUID NOT NULL REFERENCES hub_users(hub_user_global_id) ON DELETE CASCADE,
    language_code TEXT NOT NULL,
    display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
    is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (hub_user_global_id, language_code)
);

-- Available regions
CREATE TABLE available_regions (
    region_code region PRIMARY KEY,
    region_name TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO available_regions (region_code, region_name, is_active) VALUES
    ('ind1', 'India - Chennai', TRUE),
    ('usa1', 'USA - California', TRUE),
    ('deu1', 'Germany - Frankfurt', TRUE),
    ('sgp1', 'Singapore', FALSE);

-- Orgs table (global - for cross-region uniqueness and routing)
CREATE TABLE orgs (
    org_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_name TEXT NOT NULL,
    region region NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Global org domains table (for cross-region uniqueness and routing)
-- Ensures domain is claimed by ONLY ONE region/org
CREATE TABLE global_org_domains (
    domain TEXT PRIMARY KEY,
    region region NOT NULL,
    org_id UUID NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Org users table (global - routing only)
-- Note: email_address_hash is NOT unique alone - one email can belong to multiple orgs
-- (contractor scenario). Uniqueness is enforced per (email_address_hash, org_id).
CREATE TABLE org_users (
    org_user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_address_hash BYTEA NOT NULL,
    hashing_algorithm email_address_hashing_algorithm NOT NULL DEFAULT 'SHA-256',
    org_id UUID NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
    home_region region NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (email_address_hash, org_id)
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ
);

-- Email delivery attempts table
CREATE TABLE email_delivery_attempts (
    attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_id UUID NOT NULL REFERENCES emails(email_id) ON DELETE CASCADE,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    error_message TEXT
);

-- RBAC: Roles table
CREATE TABLE roles (
    role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RBAC: Admin user roles
CREATE TABLE admin_user_roles (
    admin_user_id UUID NOT NULL REFERENCES admin_users(admin_user_id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (admin_user_id, role_id)
);

-- Tags table (human-readable tag_id as PK)
CREATE TABLE tags (
    tag_id VARCHAR(64) PRIMARY KEY NOT NULL,
    small_icon_key VARCHAR(512),
    small_icon_content_type VARCHAR(100),
    large_icon_key VARCHAR(512),
    large_icon_content_type VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Translations table
CREATE TABLE tag_translations (
    tag_id VARCHAR(64) NOT NULL REFERENCES tags(tag_id) ON DELETE CASCADE,
    locale VARCHAR(10) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    PRIMARY KEY (tag_id, locale)
);

-- Insert predefined roles (admin portal only — org/hub roles live in regional DB)
INSERT INTO roles (role_name, description) VALUES
    ('admin:superadmin', 'Superadmin for the admin portal with full access to all operations'),
    ('admin:view_users', 'Can view admin user list and details (read-only)'),
    ('admin:manage_users', 'Can invite, enable/disable admin users and manage their roles'),
    ('admin:view_domains', 'Can view approved domain list and details (read-only)'),
    ('admin:manage_domains', 'Can add, enable/disable approved domains'),
    ('admin:manage_tags', 'Can create and update tags'),
    ('admin:view_audit_logs', 'Can view admin portal audit logs'),
    ('admin:view_marketplace', 'Can view marketplace capabilities, listings, and subscriptions (read-only)'),
    ('admin:manage_marketplace', 'Can manage marketplace capabilities, suspend/reinstate listings, and cancel subscriptions');

-- Admin audit logs table (unified audit log for all admin portal write operations)
CREATE TABLE admin_audit_logs (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type     VARCHAR(64) NOT NULL,
    actor_user_id  UUID,
    target_user_id UUID,
    ip_address     TEXT        NOT NULL,
    event_data     JSONB       NOT NULL DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Marketplace: capability catalog (admin-managed, global)
-- Only stores operational settings; display_name and description are in translations table
CREATE TABLE marketplace_capabilities (
    capability_id TEXT        PRIMARY KEY,
    status        TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'disabled')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Marketplace: capability translations (i18n names and descriptions)
CREATE TABLE marketplace_capability_translations (
    capability_id TEXT        NOT NULL REFERENCES marketplace_capabilities(capability_id),
    locale        TEXT        NOT NULL,
    display_name  TEXT        NOT NULL,
    description   TEXT        NOT NULL DEFAULT '',
    PRIMARY KEY (capability_id, locale)
);

-- Initial marketplace capability
INSERT INTO marketplace_capabilities (capability_id, status) VALUES ('staffing', 'active');
INSERT INTO marketplace_capability_translations (capability_id, locale, display_name, description) VALUES
    ('staffing', 'en-US', 'Staffing', 'Professional staffing and recruitment services'),
    ('staffing', 'de-DE', 'Personalvermittlung', 'Professionelle Personalvermittlung und Rekrutierung'),
    ('staffing', 'ta-IN', 'பணியாளர் நியமனம்', 'தொழில்முறை பணியாளர் நியமன மற்றும் ஆட்சேர்ப்பு சேவைகள்');

-- Global listing catalog mirror (browse-card fields for active listings across all regions)
-- Updated transactionally when a listing is published or deactivated in the regional DB
CREATE TABLE marketplace_listing_catalog (
    listing_id             UUID        PRIMARY KEY,
    org_global_id          UUID        NOT NULL,
    org_domain             TEXT        NOT NULL,
    org_region             TEXT        NOT NULL,
    capability_id          TEXT        NOT NULL REFERENCES marketplace_capabilities(capability_id),
    headline               TEXT        NOT NULL,
    summary                TEXT        NOT NULL DEFAULT '',
    regions_served         TEXT[]      NOT NULL DEFAULT '{}',
    pricing_hint           TEXT,
    contact_mode           TEXT        NOT NULL DEFAULT 'external_url' CHECK (contact_mode IN ('platform_message', 'external_url', 'email')),
    contact_value          TEXT        NOT NULL DEFAULT '',
    listed_at              TIMESTAMPTZ NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Global subscription index (routing table for provider client view across regions)
-- Updated transactionally whenever a subscription is created, reactivated, or cancelled
CREATE TABLE marketplace_subscription_index (
    subscription_id        UUID        PRIMARY KEY,
    listing_id             UUID        NOT NULL,
    consumer_org_global_id UUID        NOT NULL,
    consumer_org_domain    TEXT        NOT NULL,
    consumer_region        TEXT        NOT NULL,
    provider_org_global_id UUID        NOT NULL,
    provider_org_domain    TEXT        NOT NULL,
    capability_id          TEXT        NOT NULL,
    status                 TEXT        NOT NULL,
    started_at             TIMESTAMPTZ,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (consumer_org_global_id, listing_id)
);

-- Marketplace billing records (global, centralized)
CREATE TABLE marketplace_billing_records (
    id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_org_global_id UUID        NOT NULL,
    provider_org_domain    TEXT        NOT NULL,
    capability_id          TEXT        NOT NULL,
    event_type             TEXT        NOT NULL,
    note                   TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
CREATE INDEX idx_org_users_org_id ON org_users(org_id);
CREATE INDEX idx_org_users_email_hash ON org_users(email_address_hash);
CREATE INDEX idx_global_org_domains_org_id ON global_org_domains(org_id);
CREATE INDEX idx_admin_audit_logs_created_at_id ON admin_audit_logs(created_at DESC, id DESC);
CREATE INDEX idx_admin_audit_logs_actor_user_id ON admin_audit_logs(actor_user_id);
CREATE INDEX idx_admin_audit_logs_event_type ON admin_audit_logs(event_type);
CREATE INDEX idx_marketplace_capabilities_status ON marketplace_capabilities(status);
CREATE INDEX idx_marketplace_listing_catalog_capability ON marketplace_listing_catalog(capability_id, listed_at DESC);
CREATE INDEX idx_marketplace_listing_catalog_org ON marketplace_listing_catalog(org_global_id);
CREATE INDEX idx_marketplace_subscription_index_provider ON marketplace_subscription_index(provider_org_global_id, status, updated_at DESC);
CREATE INDEX idx_marketplace_subscription_index_consumer ON marketplace_subscription_index(consumer_org_global_id, status, updated_at DESC);
CREATE INDEX idx_marketplace_billing_records_created_at ON marketplace_billing_records(created_at DESC);

-- +goose Down
DROP INDEX IF EXISTS idx_marketplace_billing_records_created_at;
DROP INDEX IF EXISTS idx_marketplace_subscription_index_consumer;
DROP INDEX IF EXISTS idx_marketplace_subscription_index_provider;
DROP INDEX IF EXISTS idx_marketplace_listing_catalog_org;
DROP INDEX IF EXISTS idx_marketplace_listing_catalog_capability;
DROP INDEX IF EXISTS idx_marketplace_capabilities_status;
DROP TABLE IF EXISTS marketplace_billing_records;
DROP TABLE IF EXISTS marketplace_subscription_index;
DROP TABLE IF EXISTS marketplace_listing_catalog;
DROP TABLE IF EXISTS marketplace_capability_translations;
DROP TABLE IF EXISTS marketplace_capabilities;
DROP INDEX IF EXISTS idx_admin_audit_logs_event_type;
DROP INDEX IF EXISTS idx_admin_audit_logs_actor_user_id;
DROP INDEX IF EXISTS idx_admin_audit_logs_created_at_id;
DROP TABLE IF EXISTS admin_audit_logs;
DROP TABLE IF EXISTS tag_translations;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS admin_user_roles;
DROP TABLE IF EXISTS roles;
DROP INDEX IF EXISTS idx_global_org_domains_org_id;
DROP INDEX IF EXISTS idx_org_users_email_hash;
DROP INDEX IF EXISTS idx_org_users_org_id;
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
DROP TABLE IF EXISTS org_signup_tokens;
DROP TABLE IF EXISTS org_users;
DROP TABLE IF EXISTS global_org_domains;
DROP TABLE IF EXISTS orgs;
DROP TABLE IF EXISTS available_regions;
DROP TABLE IF EXISTS hub_user_display_names;
DROP TABLE IF EXISTS hub_signup_tokens;
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
