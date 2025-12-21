-- +goose Up
-- Insert test admin users into global database
-- Admin 1: admin1@vetchium.com / password: Password123$
-- Admin 2: admin2@vetchium.com / password: Password123$
-- Password hash is bcrypt hash of Password123$

INSERT INTO admin_users (admin_user_id, email_address, password_hash, status)
VALUES
    ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin1@vetchium.com', '$2a$10$ysK3vvBnAdgkjjkE2Q40n.HzZjtWKeTMlAADqCnbUOmLCgUb5fwQa', 'active'),
    ('aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin2@vetchium.com', '$2a$10$ysK3vvBnAdgkjjkE2Q40n.HzZjtWKeTMlAADqCnbUOmLCgUb5fwQa', 'active');

-- +goose Down
DELETE FROM admin_users WHERE admin_user_id IN ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
