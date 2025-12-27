-- +goose Up
CREATE TABLE hub_user_display_names (
    hub_user_global_id UUID NOT NULL REFERENCES hub_users(hub_user_global_id) ON DELETE CASCADE,
    language_code TEXT NOT NULL,
    display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
    is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (hub_user_global_id, language_code)
);

CREATE UNIQUE INDEX idx_hub_user_display_names_preferred
ON hub_user_display_names (hub_user_global_id) WHERE is_preferred = TRUE;

-- +goose Down
DROP INDEX IF EXISTS idx_hub_user_display_names_preferred;
DROP TABLE IF EXISTS hub_user_display_names;
