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
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    ('org:manage_marketplace', 'Can apply for marketplace provider capability, and create/edit/submit/pause/appeal/archive this Org''s ServiceListings'),

    -- Hub portal roles (assigned at signup, additional roles for paid features)
    ('hub:read_posts', 'Can read posts by other hub users'),
    ('hub:write_posts', 'Can create and edit posts (paid feature)'),
    ('hub:apply_jobs', 'Can apply to job postings');

-- Marketplace: org capability status enum
CREATE TYPE org_capability_status AS ENUM (
    'pending_approval',
    'active',
    'rejected',
    'expired',
    'revoked'
);

-- Marketplace: service listing state enum
CREATE TYPE service_listing_state AS ENUM (
    'draft',
    'pending_review',
    'active',
    'paused',
    'rejected',
    'suspended',
    'appealing',
    'archived'
);

-- Marketplace: service category enum
CREATE TYPE service_category AS ENUM (
    'talent_sourcing'
);

-- Marketplace: report reason enum
CREATE TYPE service_listing_report_reason AS ENUM (
    'misleading_information',
    'fraudulent',
    'inappropriate_content',
    'spam',
    'other'
);

-- Org capabilities table (one row per org per capability type)
CREATE TABLE org_capabilities (
    org_id          UUID NOT NULL,
    capability      TEXT NOT NULL,
    status          org_capability_status NOT NULL DEFAULT 'pending_approval',
    application_note TEXT,
    applied_at      TIMESTAMPTZ,
    admin_id        UUID,
    admin_note      TEXT,
    subscription_price NUMERIC(12,2),
    currency        VARCHAR(3),
    granted_at      TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, capability)
);

-- Marketplace service listings table
CREATE TABLE marketplace_service_listings (
    service_listing_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL,
    name                VARCHAR(100) NOT NULL,
    short_blurb         VARCHAR(250) NOT NULL,
    description         TEXT NOT NULL,
    service_category    service_category NOT NULL,
    countries_of_service TEXT[] NOT NULL DEFAULT '{}',
    contact_url         TEXT NOT NULL,
    pricing_info        VARCHAR(500),
    state               service_listing_state NOT NULL DEFAULT 'draft',
    appeal_exhausted    BOOLEAN NOT NULL DEFAULT false,
    last_activated_at   TIMESTAMPTZ,
    -- Talent sourcing specific fields
    industries_served       TEXT[] NOT NULL DEFAULT '{}',
    industries_served_other VARCHAR(100),
    company_sizes_served    TEXT[] NOT NULL DEFAULT '{}',
    job_functions_sourced   TEXT[] NOT NULL DEFAULT '{}',
    seniority_levels_sourced TEXT[] NOT NULL DEFAULT '{}',
    geographic_sourcing_regions TEXT[] NOT NULL DEFAULT '{}',
    -- Review metadata (overwritten on each admin action; history in audit logs)
    last_review_admin_id        UUID,
    last_review_admin_note      TEXT,
    last_review_verification_id TEXT,
    last_reviewed_at            TIMESTAMPTZ,
    -- Appeal metadata (overwritten on each suspension cycle; history in audit logs)
    appeal_reason       TEXT,
    appeal_submitted_at TIMESTAMPTZ,
    appeal_admin_note   TEXT,
    appeal_decided_at   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Marketplace service listing reports (one per OrgUser per listing)
CREATE TABLE marketplace_service_listing_reports (
    report_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_listing_id  UUID NOT NULL REFERENCES marketplace_service_listings(service_listing_id) ON DELETE CASCADE,
    reporter_org_user_id UUID NOT NULL,
    reporter_org_id     UUID NOT NULL,
    reason              service_listing_report_reason NOT NULL,
    reason_other        VARCHAR(500),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (service_listing_id, reporter_org_user_id)
);

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
CREATE INDEX idx_marketplace_service_listings_org_id ON marketplace_service_listings(org_id);
CREATE INDEX idx_marketplace_service_listings_state ON marketplace_service_listings(state);
CREATE INDEX idx_marketplace_service_listings_created_at_id ON marketplace_service_listings(created_at DESC, service_listing_id DESC);
CREATE INDEX idx_org_capabilities_status ON org_capabilities(status);
CREATE INDEX idx_marketplace_reports_listing ON marketplace_service_listing_reports(service_listing_id);
-- +goose Down
DROP INDEX IF EXISTS idx_marketplace_reports_listing;
DROP INDEX IF EXISTS idx_org_capabilities_status;
DROP INDEX IF EXISTS idx_marketplace_service_listings_created_at_id;
DROP INDEX IF EXISTS idx_marketplace_service_listings_state;
DROP INDEX IF EXISTS idx_marketplace_service_listings_org_id;
DROP TABLE IF EXISTS marketplace_service_listing_reports;
DROP TABLE IF EXISTS marketplace_service_listings;
DROP TABLE IF EXISTS org_capabilities;
DROP TYPE IF EXISTS service_listing_report_reason;
DROP TYPE IF EXISTS service_category;
DROP TYPE IF EXISTS service_listing_state;
DROP TYPE IF EXISTS org_capability_status;
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
