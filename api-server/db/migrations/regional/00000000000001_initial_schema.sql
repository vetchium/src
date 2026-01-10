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
    'hub_signup_verification',
    'hub_tfa',
    'org_signup_verification'
);

-- Domain verification status enum
CREATE TYPE domain_verification_status AS ENUM (
    'PENDING',
    'VERIFIED',
    'FAILING'
);

-- Hub users table (regional)
-- Uses hub_user_global_id as primary key (same ID as global DB for simplicity)
CREATE TABLE hub_users (
    hub_user_global_id UUID PRIMARY KEY,
    email_address TEXT NOT NULL UNIQUE,
    password_hash BYTEA,
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

-- Org users table (regional - stores credentials and PII)
CREATE TABLE org_users (
    org_user_id UUID PRIMARY KEY,
    email_address TEXT NOT NULL UNIQUE,
    password_hash BYTEA,
    created_at TIMESTAMP DEFAULT NOW()
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

-- Employer domains table (regional - stores operational data)
-- Per spec section 3.4: stores tokens, audit logs, and cron-job state
CREATE TABLE employer_domains (
    domain TEXT PRIMARY KEY,
    employer_id UUID NOT NULL,
    verification_token TEXT NOT NULL,
    token_expires_at TIMESTAMP NOT NULL,
    last_verified_at TIMESTAMP,
    consecutive_failures INT NOT NULL DEFAULT 0,
    status domain_verification_status NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_hub_tfa_tokens_expires_at ON hub_tfa_tokens(expires_at);
CREATE INDEX idx_hub_sessions_expires_at ON hub_sessions(expires_at);
CREATE INDEX idx_hub_sessions_hub_user_global_id ON hub_sessions(hub_user_global_id);
CREATE INDEX idx_org_tfa_tokens_expires_at ON org_tfa_tokens(expires_at);
CREATE INDEX idx_org_sessions_expires_at ON org_sessions(expires_at);
CREATE INDEX idx_org_sessions_org_user_id ON org_sessions(org_user_id);
CREATE INDEX idx_employer_domains_employer_id ON employer_domains(employer_id);
CREATE INDEX idx_employer_domains_status ON employer_domains(status);

-- +goose Down
DROP INDEX IF EXISTS idx_employer_domains_status;
DROP INDEX IF EXISTS idx_employer_domains_employer_id;
DROP INDEX IF EXISTS idx_org_sessions_org_user_id;
DROP INDEX IF EXISTS idx_org_sessions_expires_at;
DROP INDEX IF EXISTS idx_org_tfa_tokens_expires_at;
DROP INDEX IF EXISTS idx_hub_sessions_hub_user_global_id;
DROP INDEX IF EXISTS idx_hub_sessions_expires_at;
DROP INDEX IF EXISTS idx_hub_tfa_tokens_expires_at;
DROP TABLE IF EXISTS employer_domains;
DROP TABLE IF EXISTS org_sessions;
DROP TABLE IF EXISTS org_tfa_tokens;
DROP TABLE IF EXISTS org_users;
DROP TABLE IF EXISTS hub_sessions;
DROP TABLE IF EXISTS hub_tfa_tokens;
DROP TABLE IF EXISTS email_delivery_attempts;
DROP TABLE IF EXISTS emails;
DROP TABLE IF EXISTS hub_users;
DROP TYPE IF EXISTS domain_verification_status;
DROP TYPE IF EXISTS email_template_type;
DROP TYPE IF EXISTS email_status;
