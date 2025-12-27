-- +goose Up
CREATE TABLE hub_sessions (
    session_token TEXT PRIMARY KEY NOT NULL,
    hub_user_global_id UUID NOT NULL REFERENCES hub_users(hub_user_global_id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_hub_sessions_expires_at ON hub_sessions(expires_at);
CREATE INDEX idx_hub_sessions_hub_user_global_id ON hub_sessions(hub_user_global_id);

-- +goose Down
DROP INDEX IF EXISTS idx_hub_sessions_hub_user_global_id;
DROP INDEX IF EXISTS idx_hub_sessions_expires_at;
DROP TABLE IF EXISTS hub_sessions;
