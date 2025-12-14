-- +goose Up
-- Insert test users into global database
-- Test user 1: testuser1@example.com
-- Test user 2: testuser2@example.com
-- Email hashes are SHA-256 of the email addresses

INSERT INTO hub_users (hub_user_global_id, handle, email_address_hash, hashing_algorithm, status, preferred_language, home_region)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'testuser1', decode('f5f234e6b4028f68a41cf0a3491af8c8179f851d3906cd8bca8d63c91d831a59', 'hex'), 'SHA-256', 'active', 'en', 'ind1'),
    ('22222222-2222-2222-2222-222222222222', 'testuser2', decode('62f62c6750fb1e3648ada4f52eae0d3311ee63831864f834de13fa8c56262aac', 'hex'), 'SHA-256', 'active', 'en', 'usa1');

-- +goose Down
DELETE FROM hub_users WHERE hub_user_global_id IN ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
