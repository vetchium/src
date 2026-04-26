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
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure only one primary domain per org
CREATE UNIQUE INDEX idx_global_org_domains_primary
ON global_org_domains (org_id)
WHERE is_primary = TRUE;

-- Quarantine table: after an org unclaims a domain it sits here for DomainReleaseCooldown
-- before any org may re-claim it. Prevents domain-squatting race conditions.
CREATE TABLE domain_cooldowns (
    domain          TEXT        PRIMARY KEY,
    prev_org_id     UUID        NOT NULL REFERENCES orgs(org_id),
    released_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimable_after TIMESTAMPTZ NOT NULL
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
    ('admin:manage_marketplace', 'Can manage marketplace capabilities, suspend/reinstate listings, and cancel subscriptions'),
    ('admin:view_org_plans', 'Can view org plan subscriptions (read-only)'),
    ('admin:manage_org_plans', 'Can grant plans, waive fees, suspend, and force-downgrade');

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

-- Org Plans
CREATE TABLE plans (
    plan_id                        TEXT        PRIMARY KEY,
    display_order                  INT         NOT NULL UNIQUE,
    org_users_cap                  INT,
    domains_verified_cap           INT,
    suborgs_cap                    INT,
    marketplace_listings_cap       INT,
    audit_retention_days           INT,
    self_upgradeable               BOOLEAN     NOT NULL DEFAULT FALSE,
    status                         TEXT        NOT NULL CHECK (status IN ('active','retired')) DEFAULT 'active',
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE plan_translations (
    plan_id                        TEXT        NOT NULL REFERENCES plans(plan_id),
    locale                         TEXT        NOT NULL,
    display_name                   TEXT        NOT NULL,
    description                    TEXT        NOT NULL DEFAULT '',
    PRIMARY KEY (plan_id, locale)
);

INSERT INTO plans (plan_id, display_order, org_users_cap, domains_verified_cap, suborgs_cap, marketplace_listings_cap, audit_retention_days, self_upgradeable, status) VALUES
    ('free',       1, 5,    2,    0,  0,  30,  FALSE, 'active'),
    ('silver',     2, 25,   5,    3,  5,  365, TRUE,  'active'),
    ('gold',       3, 100,  NULL, 10, 20, 1095,TRUE,  'active'),
    ('enterprise', 4, NULL, NULL, NULL, NULL, NULL, FALSE, 'active');

INSERT INTO plan_translations (plan_id, locale, display_name, description) VALUES
    ('free',       'en-US', 'Free',       'Free tier. Discover and consume marketplace. No publishing.'),
    ('silver',     'en-US', 'Silver',     'For orgs running hiring + modest marketplace listings.'),
    ('gold',       'en-US', 'Gold',       'For heavy operators — staffing firms, multi-site employers.'),
    ('enterprise', 'en-US', 'Enterprise', 'Custom commercial terms. Contact us.'),
    ('free', 'de-DE', 'Kostenlos', ''),
    ('silver', 'de-DE', 'Silber', ''),
    ('gold', 'de-DE', 'Gold', ''),
    ('enterprise', 'de-DE', 'Enterprise', ''),
    ('free', 'ta-IN', 'இலவசம்', ''),
    ('silver', 'ta-IN', 'வெள்ளி', ''),
    ('gold', 'ta-IN', 'தங்கம்', ''),
    ('enterprise', 'ta-IN', 'நிறுவனம்', '');

CREATE TABLE org_plans (
    org_id                    UUID         PRIMARY KEY REFERENCES orgs(org_id),
    current_plan_id           TEXT         NOT NULL REFERENCES plans(plan_id),
    updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_by_admin_id       UUID,
    updated_by_org_user_id    UUID,
    note                      TEXT         NOT NULL DEFAULT ''
);

CREATE TABLE org_plan_history (
    history_id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id                    UUID         NOT NULL,
    from_plan_id              TEXT,
    to_plan_id                TEXT         NOT NULL,
    changed_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    changed_by_admin_id       UUID,
    changed_by_org_user_id    UUID,
    reason                    TEXT         NOT NULL DEFAULT ''
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

-- Marketplace
CREATE TABLE marketplace_capabilities (
    capability_id TEXT        PRIMARY KEY CHECK (capability_id ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
    status        TEXT        NOT NULL CHECK (status IN ('draft','active','disabled')) DEFAULT 'draft',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE marketplace_capability_translations (
    capability_id TEXT NOT NULL REFERENCES marketplace_capabilities(capability_id),
    locale        TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (capability_id, locale)
);

-- Global mirror of active listings (for cross-region discovery)
CREATE TABLE marketplace_listing_catalog (
    listing_id          UUID        PRIMARY KEY,
    org_id              UUID        NOT NULL REFERENCES orgs(org_id),
    org_domain          TEXT        NOT NULL,
    listing_number      INT         NOT NULL,
    headline            TEXT        NOT NULL,
    description         TEXT        NOT NULL,
    capability_ids      TEXT[]      NOT NULL,
    listed_at           TIMESTAMPTZ NOT NULL,
    updated_at          TIMESTAMPTZ NOT NULL,
    UNIQUE (org_domain, listing_number)
);
CREATE INDEX idx_marketplace_listing_catalog_capability ON marketplace_listing_catalog USING GIN (capability_ids);

-- Global subscription index (routing for provider cross-region client view)
CREATE TABLE marketplace_subscription_index (
    subscription_id        UUID        PRIMARY KEY,
    listing_id             UUID        NOT NULL,
    consumer_org_id        UUID        NOT NULL REFERENCES orgs(org_id),
    consumer_region        TEXT        NOT NULL,
    provider_org_id        UUID        NOT NULL REFERENCES orgs(org_id),
    provider_region        TEXT        NOT NULL,
    status                 TEXT        NOT NULL,
    updated_at             TIMESTAMPTZ NOT NULL,
    UNIQUE (consumer_org_id, listing_id)
);

-- Seed a sample capability so discovery isn't empty
INSERT INTO marketplace_capabilities (capability_id, status) VALUES ('staffing', 'active');
INSERT INTO marketplace_capability_translations VALUES
    ('staffing', 'en-US', 'Staffing', 'Recruitment and staffing services'),
    ('staffing', 'de-DE', 'Personalvermittlung', ''),
    ('staffing', 'ta-IN', 'பணியாளர் சேர்க்கை', '');

-- +goose Down
DROP TABLE IF EXISTS marketplace_subscription_index;
DROP TABLE IF EXISTS marketplace_listing_catalog;
DROP TABLE IF EXISTS marketplace_capability_translations;
DROP TABLE IF EXISTS marketplace_capabilities;
DROP TABLE IF EXISTS org_plan_history;
DROP TABLE IF EXISTS org_plans;
DROP TABLE IF EXISTS plan_translations;
DROP TABLE IF EXISTS plans;
DROP INDEX IF EXISTS idx_admin_audit_logs_event_type;
DROP INDEX IF EXISTS idx_admin_audit_logs_actor_user_id;
DROP INDEX IF EXISTS idx_admin_audit_logs_created_at_id;
DROP TABLE IF EXISTS admin_audit_logs;
DROP TABLE IF EXISTS tag_translations;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS admin_user_roles;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS domain_cooldowns;
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
