-- +goose Up
-- Insert test users into regional database
-- Test user 1: testuser1@example.com / password: password1234
-- Test user 2: testuser2@example.com / password: password4567
-- Password hashes are bcrypt hashes

INSERT INTO hub_users (hub_user_id, hub_user_global_id, email_address, password_hash)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'testuser1@example.com', '$2a$10$vWceUgWNdbqud.4L.iLF0uVeQVh5rv5PCjSACOnWCJtnSpUVT89FO'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'testuser2@example.com', '$2a$10$VpWvcBXeKUIIXeXPwq3nzeZ/gb77/Nfs9Ze3CL7.7aqtEmEQr.Zz2');

-- +goose Down
DELETE FROM hub_users WHERE hub_user_global_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
