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

-- Marketplace capabilities are platform-level data, not dev fixtures: the canonical
-- list ('staffing', 'background-verification') with all three locale translations is
-- seeded once in the migration (global initial_schema.sql). Nothing to add here — the
-- dev agency (Floo Network Staffing) is created via API in seed-users.ts and lists
-- against those capabilities.
