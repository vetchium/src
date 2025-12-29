-- +goose Up
ALTER TYPE email_template_type ADD VALUE 'hub_tfa';

-- +goose Down
-- Note: PostgreSQL doesn't support removing enum values, so down migration is not possible
-- If you need to rollback, you would need to recreate the enum entirely
