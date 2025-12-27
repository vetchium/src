-- +goose Up
-- Create domain status enum
CREATE TYPE domain_status AS ENUM ('active', 'inactive');

-- Add status column to approved_domains
ALTER TABLE approved_domains
ADD COLUMN status domain_status NOT NULL DEFAULT 'active';

-- Migrate existing data: if deleted_at IS NULL then active, else inactive
UPDATE approved_domains
SET status = CASE
    WHEN deleted_at IS NULL THEN 'active'::domain_status
    ELSE 'inactive'::domain_status
END;

-- Drop deleted_at column as it's replaced by status
ALTER TABLE approved_domains
DROP COLUMN deleted_at;

-- Add reason column to audit log for enable/disable actions
ALTER TABLE approved_domains_audit_log
ADD COLUMN reason VARCHAR(256);

-- +goose Down
-- Add back deleted_at column
ALTER TABLE approved_domains
ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE;

-- Migrate status back to deleted_at: inactive domains get current timestamp
UPDATE approved_domains
SET deleted_at = CASE
    WHEN status = 'inactive'::domain_status THEN NOW()
    ELSE NULL
END;

-- Drop reason column from audit log
ALTER TABLE approved_domains_audit_log
DROP COLUMN reason;

-- Drop status column
ALTER TABLE approved_domains
DROP COLUMN status;

-- Drop domain status enum
DROP TYPE domain_status;
