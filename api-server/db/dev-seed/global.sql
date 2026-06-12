-- Development seed data for global database
-- This file is NOT for production - it contains test data for development
-- Hub users (Harry Potter characters) are created via API in seed-users.ts

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
    (ia.email_address = 'admin1@vetchium.com' AND r.role_name = 'admin:superadmin')
    OR
    (ia.email_address = 'admin2@vetchium.com' AND r.role_name = 'admin:manage_users')
ON CONFLICT DO NOTHING;

-- Marketplace capabilities (capability_id + status; human-readable text lives in
-- marketplace_capability_translations). 'staffing' is already seeded by the migration;
-- ON CONFLICT keeps this idempotent.
INSERT INTO marketplace_capabilities (capability_id, status)
VALUES
    ('staffing', 'active'),
    ('talent-sourcing', 'active'),
    ('background-checks', 'active')
ON CONFLICT (capability_id) DO UPDATE
SET status = 'active', updated_at = NOW();

INSERT INTO marketplace_capability_translations (capability_id, locale, display_name, description)
VALUES
    ('staffing', 'en-US', 'Staffing Services', 'Hire professional staff for your organization through our network of providers.'),
    ('talent-sourcing', 'en-US', 'Talent Sourcing', 'Find the best talent for your open positions using advanced sourcing tools and services.'),
    ('background-checks', 'en-US', 'Background Checks', 'Verify the credentials and history of your candidates with reliable background check providers.')
ON CONFLICT (capability_id, locale) DO UPDATE
SET display_name = EXCLUDED.display_name, description = EXCLUDED.description;
