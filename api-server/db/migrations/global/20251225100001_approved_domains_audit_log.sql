-- +goose Up
-- Audit log for approved domains management
CREATE TABLE approved_domains_audit_log (
    audit_id UUID PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
    admin_id UUID REFERENCES admin_users(admin_user_id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    target_domain_id UUID REFERENCES approved_domains(domain_id) ON DELETE SET NULL,
    target_domain_name VARCHAR(255),
    old_value JSONB,
    new_value JSONB,
    ip_address INET,
    user_agent TEXT,
    request_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- +goose Down
DROP TABLE IF EXISTS approved_domains_audit_log;
