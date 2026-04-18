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
    'org_suborg_disabled'
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

-- Domain verification status enum
CREATE TYPE domain_verification_status AS ENUM ('PENDING', 'VERIFIED', 'FAILING');
-- Cost center status enum
CREATE TYPE cost_center_status AS ENUM ('enabled', 'disabled');
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
    created_at TIMESTAMPTZ DEFAULT NOW()
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ
);
-- Email delivery attempts
CREATE TABLE email_delivery_attempts (
    attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_id UUID NOT NULL REFERENCES emails(email_id) ON DELETE CASCADE,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    error_message TEXT
);
-- Hub TFA tokens for email-based two-factor authentication
CREATE TABLE hub_tfa_tokens (
    tfa_token TEXT PRIMARY KEY NOT NULL,
    hub_user_global_id UUID NOT NULL REFERENCES hub_users(hub_user_global_id) ON DELETE CASCADE,
    tfa_code TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);
-- Hub sessions (regional storage for data sovereignty)
CREATE TABLE hub_sessions (
    session_token TEXT PRIMARY KEY NOT NULL,
    hub_user_global_id UUID NOT NULL REFERENCES hub_users(hub_user_global_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);
-- Hub password reset tokens
CREATE TABLE hub_password_reset_tokens (
    reset_token TEXT PRIMARY KEY NOT NULL,
    hub_user_global_id UUID NOT NULL REFERENCES hub_users(hub_user_global_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);
-- Hub email verification tokens
CREATE TABLE hub_email_verification_tokens (
    verification_token TEXT PRIMARY KEY NOT NULL,
    hub_user_global_id UUID NOT NULL REFERENCES hub_users(hub_user_global_id) ON DELETE CASCADE,
    new_email_address TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);
-- Org users table (regional - stores credentials, PII, and all mutable data)
-- Note: email_address is NOT unique alone - one email can belong to multiple orgs
-- (contractor scenario). Uniqueness is enforced per (email_address, org_id).
CREATE TABLE org_users (
    org_user_id UUID PRIMARY KEY,
    email_address TEXT NOT NULL,
    org_id UUID NOT NULL,
    full_name TEXT,
    password_hash BYTEA,
    authentication_type authentication_type NOT NULL DEFAULT 'email_password',
    status org_user_status NOT NULL DEFAULT 'active',
    preferred_language TEXT NOT NULL DEFAULT 'en-US',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (email_address, org_id)
);
-- Org TFA tokens for email-based two-factor authentication
CREATE TABLE org_tfa_tokens (
    tfa_token TEXT PRIMARY KEY NOT NULL,
    org_user_id UUID NOT NULL REFERENCES org_users(org_user_id) ON DELETE CASCADE,
    tfa_code TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);
-- Org sessions (regional storage for data sovereignty)
CREATE TABLE org_sessions (
    session_token TEXT PRIMARY KEY NOT NULL,
    org_user_id UUID NOT NULL REFERENCES org_users(org_user_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);
-- Org password reset tokens
CREATE TABLE org_password_reset_tokens (
    reset_token TEXT PRIMARY KEY NOT NULL,
    org_user_global_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);
-- Org invitation tokens for user invitations
CREATE TABLE org_invitation_tokens (
    invitation_token TEXT PRIMARY KEY NOT NULL,
    org_user_id UUID NOT NULL REFERENCES org_users(org_user_id) ON DELETE CASCADE,
    org_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);
-- Org domains table (regional - stores operational data)
-- Per spec section 3.4: stores tokens, audit logs, and cron-job state
CREATE TABLE org_domains (
    domain TEXT PRIMARY KEY,
    org_id UUID NOT NULL,
    verification_token TEXT NOT NULL,
    token_expires_at TIMESTAMPTZ NOT NULL,
    last_verified_at TIMESTAMPTZ,
    last_verification_requested_at TIMESTAMPTZ,
    consecutive_failures INT NOT NULL DEFAULT 0,
    status domain_verification_status NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Cost centers for organizations
CREATE TABLE cost_centers (
    cost_center_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id         UUID NOT NULL,
    id             VARCHAR(64) NOT NULL,
    display_name   VARCHAR(64) NOT NULL,
    status         cost_center_status NOT NULL DEFAULT 'enabled',
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, id)
);
-- SubOrgs: sub-entities of an org, each pinned to a Vetchium region
CREATE TABLE suborgs (
    suborg_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID        NOT NULL,
    name          VARCHAR(64) NOT NULL,
    pinned_region VARCHAR(32) NOT NULL,
    status        VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, name)
);
-- SubOrg membership: org users assigned to a SubOrg
CREATE TABLE org_user_suborg_assignments (
    suborg_id   UUID      NOT NULL REFERENCES suborgs(suborg_id) ON DELETE CASCADE,
    org_user_id UUID      NOT NULL REFERENCES org_users(org_user_id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (suborg_id, org_user_id)
);
-- RBAC: Roles table
CREATE TABLE roles (
    role_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- RBAC: Org user roles
CREATE TABLE org_user_roles (
    org_user_id UUID NOT NULL REFERENCES org_users(org_user_id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_user_id, role_id)
);
-- RBAC: Hub user roles
CREATE TABLE hub_user_roles (
    hub_user_global_id UUID NOT NULL REFERENCES hub_users(hub_user_global_id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (hub_user_global_id, role_id)
);
-- Insert predefined roles (org/hub portals only — admin roles live in global DB)
INSERT INTO roles (role_name, description) VALUES
    -- Org portal roles
    ('org:view_users', 'Can view org user list and details (read-only)'),
    ('org:manage_users', 'Can invite, enable/disable org users and manage their roles'),
    ('org:view_domains', 'Can view org domain list and status (read-only)'),
    ('org:manage_domains', 'Can claim, verify and delete org domains'),
    ('org:view_costcenters', 'Can view cost centers for their organization (read-only)'),
    ('org:manage_costcenters', 'Can create, update and manage cost centers for their organization'),
    ('org:view_suborgs', 'Can view all SubOrgs and their membership details (read-only)'),
    ('org:manage_suborgs', 'Can create, rename, disable, re-enable SubOrgs and manage their membership'),
    ('org:superadmin', 'Superadmin for the org portal with full access to all operations'),
    ('org:view_audit_logs', 'Can view org portal audit logs for their organization'),
    ('org:view_listings', 'Can view own marketplace listings and their subscriber list (read-only)'),
    ('org:manage_listings', 'Can create, edit, publish, and archive own marketplace listings'),
    ('org:view_subscriptions', 'Can view own marketplace subscriptions (read-only)'),
    ('org:manage_subscriptions', 'Can create and cancel marketplace subscriptions'),
    ('org:view_subscription', 'Can view own org tier subscription and usage (read-only)'),
    ('org:manage_subscription', 'Can upgrade own org tier subscription'),

    -- Hub portal roles (assigned at signup, additional roles for paid features)
    ('hub:read_posts', 'Can read posts by other hub users'),
    ('hub:write_posts', 'Can create and edit posts (paid feature)'),
    ('hub:apply_jobs', 'Can apply to job postings');

-- Audit logs table (unified audit log for org and hub portal write operations)
CREATE TABLE audit_logs (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type     VARCHAR(64) NOT NULL,
    actor_user_id  UUID,
    target_user_id UUID,
    org_id         UUID,
    ip_address     TEXT        NOT NULL,
    event_data     JSONB       NOT NULL DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
CREATE INDEX idx_org_users_org_id ON org_users(org_id);
CREATE INDEX idx_cost_centers_org_id_created_at ON cost_centers(org_id, created_at);
CREATE INDEX idx_suborgs_org_id_created_at ON suborgs(org_id, created_at);
CREATE INDEX idx_org_user_suborg_assignments_org_user_id ON org_user_suborg_assignments(org_user_id);
CREATE INDEX idx_org_domains_org_id ON org_domains(org_id);
CREATE INDEX idx_org_domains_status ON org_domains(status);
CREATE INDEX idx_audit_logs_created_at_id ON audit_logs(created_at DESC, id DESC);
CREATE INDEX idx_audit_logs_actor_user_id ON audit_logs(actor_user_id);
CREATE INDEX idx_audit_logs_org_created_at_id ON audit_logs(org_id, created_at DESC, id DESC);
CREATE INDEX idx_audit_logs_event_type ON audit_logs(event_type);

-- Marketplace
CREATE TYPE marketplace_listing_status AS ENUM ('draft','pending_review','active','suspended','archived');
CREATE TYPE marketplace_subscription_status AS ENUM ('active','cancelled','expired');

-- Per-org atomic listing number counter
CREATE TABLE org_marketplace_listing_counters (
    org_id            UUID NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE PRIMARY KEY,
    last_listing_number INT NOT NULL DEFAULT 0
);

CREATE TABLE marketplace_listings (
    listing_id        UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id            UUID NOT NULL REFERENCES orgs(org_id),
    org_domain        TEXT NOT NULL,
    listing_number    INT  NOT NULL,
    headline          TEXT NOT NULL CHECK (char_length(headline) <= 100),
    description       TEXT NOT NULL CHECK (char_length(description) <= 10000),
    status            marketplace_listing_status NOT NULL DEFAULT 'draft',
    suspension_note   TEXT,
    rejection_note    TEXT,
    listed_at         TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, listing_number)
);

CREATE TABLE marketplace_listing_capabilities (
    listing_id      UUID NOT NULL REFERENCES marketplace_listings(listing_id) ON DELETE CASCADE,
    capability_id   TEXT NOT NULL,
    added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    removed_at      TIMESTAMPTZ,
    PRIMARY KEY (listing_id, capability_id)
);
CREATE INDEX idx_marketplace_listings_org ON marketplace_listings(org_id, status, updated_at DESC);

CREATE TABLE marketplace_subscriptions (
    subscription_id           UUID NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id                UUID NOT NULL,
    consumer_org_id           UUID NOT NULL REFERENCES orgs(org_id),
    consumer_org_domain       TEXT NOT NULL,
    provider_org_id           UUID NOT NULL,
    provider_org_domain       TEXT NOT NULL,
    provider_listing_number   INT  NOT NULL,
    request_note              TEXT NOT NULL DEFAULT '' CHECK (char_length(request_note) <= 2000),
    status                    marketplace_subscription_status NOT NULL DEFAULT 'active',
    started_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at                TIMESTAMPTZ,
    cancelled_at              TIMESTAMPTZ,
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (consumer_org_id, listing_id)
);
CREATE INDEX idx_marketplace_subscriptions_consumer ON marketplace_subscriptions(consumer_org_id, status, updated_at DESC);

-- +goose Down
DROP INDEX IF EXISTS idx_marketplace_subscriptions_consumer;
DROP TABLE IF EXISTS marketplace_subscriptions;
DROP INDEX IF EXISTS idx_marketplace_listings_org;
DROP TABLE IF EXISTS marketplace_listing_capabilities;
DROP TABLE IF EXISTS marketplace_listings;
DROP TABLE IF EXISTS org_marketplace_listing_counters;
DROP TYPE IF EXISTS marketplace_subscription_status;
DROP TYPE IF EXISTS marketplace_listing_status;
DROP INDEX IF EXISTS idx_audit_logs_event_type;
DROP INDEX IF EXISTS idx_audit_logs_org_created_at_id;
DROP INDEX IF EXISTS idx_audit_logs_actor_user_id;
DROP INDEX IF EXISTS idx_audit_logs_created_at_id;
DROP TABLE IF EXISTS audit_logs;
DROP INDEX IF EXISTS idx_org_domains_status;
DROP INDEX IF EXISTS idx_org_domains_org_id;
DROP INDEX IF EXISTS idx_org_user_suborg_assignments_org_user_id;
DROP INDEX IF EXISTS idx_suborgs_org_id_created_at;
DROP TABLE IF EXISTS org_user_suborg_assignments;
DROP TABLE IF EXISTS suborgs;
DROP INDEX IF EXISTS idx_cost_centers_org_id_created_at;
DROP INDEX IF EXISTS idx_org_users_org_id;
DROP INDEX IF EXISTS idx_org_users_email_address;
DROP INDEX IF EXISTS idx_org_invitation_tokens_expires_at;
DROP INDEX IF EXISTS idx_org_password_reset_tokens_expires_at;
DROP INDEX IF EXISTS idx_org_sessions_org_user_id;
DROP INDEX IF EXISTS idx_org_sessions_expires_at;
DROP INDEX IF EXISTS idx_org_tfa_tokens_expires_at;
DROP TABLE IF EXISTS hub_user_roles;
DROP TABLE IF EXISTS org_user_roles;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS org_invitation_tokens;
DROP TABLE IF EXISTS org_domains;
DROP TABLE IF EXISTS cost_centers;
DROP TABLE IF EXISTS org_password_reset_tokens;
DROP TABLE IF EXISTS org_sessions;
DROP TABLE IF EXISTS org_tfa_tokens;
DROP TABLE IF EXISTS org_users;
DROP INDEX IF EXISTS idx_hub_email_verification_tokens_expires_at;
DROP INDEX IF EXISTS idx_hub_password_reset_tokens_expires_at;
DROP INDEX IF EXISTS idx_hub_sessions_hub_user_global_id;
DROP INDEX IF EXISTS idx_hub_sessions_expires_at;
DROP INDEX IF EXISTS idx_hub_tfa_tokens_expires_at;
DROP TABLE IF EXISTS hub_email_verification_tokens;
DROP TABLE IF EXISTS hub_password_reset_tokens;
DROP TABLE IF EXISTS hub_sessions;
DROP TABLE IF EXISTS hub_tfa_tokens;
DROP TABLE IF EXISTS email_delivery_attempts;
DROP TABLE IF EXISTS emails;
DROP TABLE IF EXISTS hub_users;
DROP TYPE IF EXISTS cost_center_status;
DROP TYPE IF EXISTS domain_verification_status;
DROP TYPE IF EXISTS org_user_status;
DROP TYPE IF EXISTS hub_user_status;
DROP TYPE IF EXISTS authentication_type;
DROP TYPE IF EXISTS email_template_type;
DROP TYPE IF EXISTS email_status;
