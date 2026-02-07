-- Development seed data for regional databases
-- This file is NOT for production - it contains test users for development

-- Test hub users (password: Password123$)
INSERT INTO hub_users (hub_user_global_id, email_address, handle, password_hash, status, preferred_language)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'testuser1@example.com', 'testuser1', '$2a$10$ysK3vvBnAdgkjjkE2Q40n.HzZjtWKeTMlAADqCnbUOmLCgUb5fwQa', 'active', 'en-US'),
    ('22222222-2222-2222-2222-222222222222', 'testuser2@example.com', 'testuser2', '$2a$10$ysK3vvBnAdgkjjkE2Q40n.HzZjtWKeTMlAADqCnbUOmLCgUb5fwQa', 'active', 'en-US')
ON CONFLICT DO NOTHING;
