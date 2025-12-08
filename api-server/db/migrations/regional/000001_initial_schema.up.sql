-- Regional database initial schema

-- Hub users table (regional)
CREATE TABLE hub_users (
    hub_user_id UUID PRIMARY KEY,
    hub_user_global_id UUID NOT NULL,
    email_address TEXT NOT NULL UNIQUE,
    password_hash BYTEA,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index for faster lookups by global ID
CREATE INDEX idx_hub_users_global_id ON hub_users(hub_user_global_id);
