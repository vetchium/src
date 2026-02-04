-- Development seed data for global database
-- This file is NOT for production - it contains test users for development

-- Test hub users
-- Email hashes are SHA-256 of the email addresses
INSERT INTO hub_users (hub_user_global_id, handle, email_address_hash, hashing_algorithm, status, preferred_language, home_region)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'testuser1', decode('f5f234e6b4028f68a41cf0a3491af8c8179f851d3906cd8bca8d63c91d831a59', 'hex'), 'SHA-256', 'active', 'en', 'ind1'),
    ('22222222-2222-2222-2222-222222222222', 'testuser2', decode('62f62c6750fb1e3648ada4f52eae0d3311ee63831864f834de13fa8c56262aac', 'hex'), 'SHA-256', 'active', 'en', 'usa1')
ON CONFLICT DO NOTHING;

-- Test admin users (password: Password123$)
-- Use CTE to capture inserted UUIDs and assign roles in one transaction-like operation
WITH inserted_admins AS (
    INSERT INTO admin_users (admin_user_id, email_address, password_hash, status)
    VALUES
        (gen_random_uuid(), 'admin1@vetchium.com', '$2a$10$ysK3vvBnAdgkjjkE2Q40n.HzZjtWKeTMlAADqCnbUOmLCgUb5fwQa', 'active'),
        (gen_random_uuid(), 'admin2@vetchium.com', '$2a$10$ysK3vvBnAdgkjjkE2Q40n.HzZjtWKeTMlAADqCnbUOmLCgUb5fwQa', 'active')
    ON CONFLICT DO NOTHING
    RETURNING admin_user_id, email_address
)
INSERT INTO admin_user_roles (admin_user_id, role_id)
SELECT ia.admin_user_id, r.role_id
FROM inserted_admins ia
CROSS JOIN roles r
WHERE
    (ia.email_address = 'admin1@vetchium.com' AND r.role_name IN ('admin:invite_users', 'admin:manage_users'))
    OR
    (ia.email_address = 'admin2@vetchium.com' AND r.role_name = 'admin:invite_users')
ON CONFLICT DO NOTHING;
