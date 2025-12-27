-- +goose Up
CREATE TABLE hub_signup_tokens (
    signup_token TEXT PRIMARY KEY NOT NULL,
    email_address TEXT NOT NULL,
    email_address_hash BYTEA NOT NULL,
    hashing_algorithm email_address_hashing_algorithm NOT NULL DEFAULT 'SHA-256',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP
);

CREATE INDEX idx_hub_signup_tokens_expires_at ON hub_signup_tokens(expires_at);
CREATE INDEX idx_hub_signup_tokens_email_hash ON hub_signup_tokens(email_address_hash);

-- +goose Down
DROP INDEX IF EXISTS idx_hub_signup_tokens_email_hash;
DROP INDEX IF EXISTS idx_hub_signup_tokens_expires_at;
DROP TABLE IF EXISTS hub_signup_tokens;
