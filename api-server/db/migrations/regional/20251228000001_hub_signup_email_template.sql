-- +goose Up
ALTER TYPE email_template_type ADD VALUE 'hub_signup_verification';

-- +goose Down
-- Cannot remove enum values in PostgreSQL without recreating the enum
-- This is acceptable as old values don't harm the system
