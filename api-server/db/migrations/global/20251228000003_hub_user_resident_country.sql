-- +goose Up
ALTER TABLE hub_users ADD COLUMN resident_country_code TEXT;

-- +goose Down
ALTER TABLE hub_users DROP COLUMN IF EXISTS resident_country_code;
