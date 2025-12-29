-- +goose Up
-- Hub TFA tokens for email-based two-factor authentication
CREATE TABLE hub_tfa_tokens (
    tfa_token TEXT PRIMARY KEY NOT NULL,
    hub_user_id UUID NOT NULL REFERENCES hub_users(hub_user_id) ON DELETE CASCADE,
    tfa_code TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);

-- Index for cleanup of expired tokens
CREATE INDEX idx_hub_tfa_tokens_expires_at ON hub_tfa_tokens(expires_at);

-- +goose Down
DROP INDEX IF EXISTS idx_hub_tfa_tokens_expires_at;
DROP TABLE IF EXISTS hub_tfa_tokens;
