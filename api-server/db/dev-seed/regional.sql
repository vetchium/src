-- Development seed data for regional databases
-- This file is NOT for production - it contains test users for development

-- Test hub users (password: Password123$)
INSERT INTO hub_users (hub_user_id, hub_user_global_id, email_address, password_hash)
VALUES
    (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'testuser1@example.com', '$2a$10$ysK3vvBnAdgkjjkE2Q40n.HzZjtWKeTMlAADqCnbUOmLCgUb5fwQa'),
    (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 'testuser2@example.com', '$2a$10$ysK3vvBnAdgkjjkE2Q40n.HzZjtWKeTMlAADqCnbUOmLCgUb5fwQa')
ON CONFLICT DO NOTHING;
