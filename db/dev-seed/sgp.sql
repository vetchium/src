-- Local-development fixtures for the "sgp" tenant.

INSERT INTO vetchium.orgs (name) VALUES
    ('sgp_org_1'),
    ('sgp_org_2')
ON CONFLICT (name) DO NOTHING;

INSERT INTO vetchium.hub_users (username, org_id)
SELECT v.username, o.id
FROM (VALUES
    ('sgp_user_1', 'sgp_org_1'),
    ('sgp_user_2', 'sgp_org_2')
) AS v (username, org_name)
JOIN vetchium.orgs o ON o.name = v.org_name
ON CONFLICT (username) DO NOTHING;

-- Local-only administrator; credentials are documented in db/README.md.
INSERT INTO vetchium.admin_users (
    email_address,
    display_name,
    password_hash,
    admin_user_state,
    primary_display_name_language
) VALUES (
    'admin@sgp.example',
    'sgp Administrator',
    '$2a$10$7YcuXQJ0D7dW107.o2iwWe1NrtR4GXuN1qsEHnK7ovp8/aViyq7.S',
    'active',
    'en-US'
)
ON CONFLICT (email_address) DO UPDATE SET
    password_hash = EXCLUDED.password_hash;

INSERT INTO vetchium.admin_display_names (admin_user_id, language_code, display_name)
SELECT admin_user_id, primary_display_name_language, display_name
FROM vetchium.admin_users
WHERE email_address = 'admin@sgp.example'
ON CONFLICT (admin_user_id, language_code) DO NOTHING;

INSERT INTO vetchium.admin_permissions (admin_user_id, permission)
SELECT admin_user_id, 'admin:manage_users'
FROM vetchium.admin_users
WHERE email_address = 'admin@sgp.example'
ON CONFLICT (admin_user_id, permission) DO NOTHING;
