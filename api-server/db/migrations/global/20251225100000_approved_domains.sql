-- +goose Up
-- Approved domains table - controls which email domains can register HubUsers
CREATE TABLE approved_domains (
    domain_id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    domain_name VARCHAR(255) NOT NULL UNIQUE,
    created_by_admin_id UUID NOT NULL REFERENCES admin_users(admin_user_id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION update_approved_domains_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER approved_domains_updated_at
    BEFORE UPDATE ON approved_domains
    FOR EACH ROW
    EXECUTE FUNCTION update_approved_domains_updated_at();

-- +goose Down
DROP TRIGGER IF EXISTS approved_domains_updated_at ON approved_domains;
DROP FUNCTION IF EXISTS update_approved_domains_updated_at();
DROP TABLE IF EXISTS approved_domains;
