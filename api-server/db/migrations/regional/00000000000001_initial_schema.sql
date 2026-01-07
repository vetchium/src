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
    'hub_tfa'
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

-- Indexes
CREATE INDEX idx_hub_tfa_tokens_expires_at ON hub_tfa_tokens(expires_at);
CREATE INDEX idx_hub_sessions_expires_at ON hub_sessions(expires_at);
CREATE INDEX idx_hub_sessions_hub_user_global_id ON hub_sessions(hub_user_global_id);

-- +goose Down
DROP INDEX IF EXISTS idx_hub_sessions_hub_user_global_id;
DROP INDEX IF EXISTS idx_hub_sessions_expires_at;
DROP INDEX IF EXISTS idx_hub_tfa_tokens_expires_at;
DROP TABLE IF EXISTS hub_sessions;
DROP TABLE IF EXISTS hub_tfa_tokens;
DROP TABLE IF EXISTS email_delivery_attempts;
DROP TABLE IF EXISTS emails;
DROP TABLE IF EXISTS hub_users;
DROP TYPE IF EXISTS email_template_type;
DROP TYPE IF EXISTS email_status;
