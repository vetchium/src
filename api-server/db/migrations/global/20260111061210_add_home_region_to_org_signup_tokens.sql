-- +goose Up
-- +goose StatementBegin
ALTER TABLE org_signup_tokens ADD COLUMN home_region region NOT NULL DEFAULT 'ind1';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE org_signup_tokens DROP COLUMN home_region;
-- +goose StatementEnd
