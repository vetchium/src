-- +goose Up
-- Admin user status enum
CREATE TYPE admin_user_status AS ENUM (
    'active',
    'disabled'
);

-- Admin users table (global only - admins are platform-wide, not regional)
CREATE TABLE admin_users (
    admin_user_id UUID PRIMARY KEY NOT NULL,
    email_address TEXT NOT NULL UNIQUE,
    password_hash BYTEA NOT NULL,
    status admin_user_status NOT NULL,
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

-- Index for cleanup of expired tokens/sessions
CREATE INDEX idx_admin_tfa_tokens_expires_at ON admin_tfa_tokens(expires_at);
CREATE INDEX idx_admin_sessions_expires_at ON admin_sessions(expires_at);

-- +goose Down
DROP INDEX IF EXISTS idx_admin_sessions_expires_at;
DROP INDEX IF EXISTS idx_admin_tfa_tokens_expires_at;
DROP TABLE IF EXISTS admin_sessions;
DROP TABLE IF EXISTS admin_tfa_tokens;
DROP TABLE IF EXISTS admin_users;
DROP TYPE IF EXISTS admin_user_status;
