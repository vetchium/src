-- Local-development fixtures for the "usa1" tenant.

INSERT INTO vetchium.orgs (name) VALUES
    ('usa1_org_1'),
    ('usa1_org_2')
ON CONFLICT (name) DO NOTHING;

INSERT INTO vetchium.hub_users (username, org_id)
SELECT v.username, o.id
FROM (VALUES
    ('usa1_user_1', 'usa1_org_1'),
    ('usa1_user_2', 'usa1_org_2')
) AS v (username, org_name)
JOIN vetchium.orgs o ON o.name = v.org_name
ON CONFLICT (username) DO NOTHING;

-- Local-only administrators, one for each combination of access and account
-- state a portal has to present. Their shared password is documented in
-- db/README.md. The temporary table keeps the three writes below driven by one
-- list, so seeding another administrator is one row.
CREATE TEMP TABLE seeded_admins (
    email_address text PRIMARY KEY,
    display_name text NOT NULL,
    admin_user_state vetchium.admin_user_state NOT NULL,
    permissions text[] NOT NULL
) ON COMMIT DROP;

INSERT INTO seeded_admins (
    email_address, display_name, admin_user_state, permissions
) VALUES
    ('admin@usa1.example', 'usa1 Administrator', 'active',
        ARRAY['admin:manage_users']),
    ('manager@usa1.example', 'usa1 Access Manager', 'active',
        ARRAY['admin:manage_users']),
    ('viewer@usa1.example', 'usa1 Access Reviewer', 'active',
        ARRAY['admin:view_users']),
    ('newcomer@usa1.example', 'usa1 Unassigned Administrator', 'active',
        ARRAY[]::text[]),
    ('retired@usa1.example', 'usa1 Retired Administrator', 'disabled',
        ARRAY['admin:view_users']);

-- An administrator that already exists keeps the state and the access the
-- tenant has given them since; only the fixture password is restored.
INSERT INTO vetchium.admin_users (
    email_address,
    display_name,
    password_hash,
    admin_user_state,
    primary_display_name_language
)
SELECT
    email_address,
    display_name,
    '$2a$10$7YcuXQJ0D7dW107.o2iwWe1NrtR4GXuN1qsEHnK7ovp8/aViyq7.S',
    admin_user_state,
    'en-US'
FROM seeded_admins
ON CONFLICT (email_address) DO UPDATE SET
    password_hash = EXCLUDED.password_hash;

INSERT INTO vetchium.admin_display_names (
    admin_user_id, language_code, display_name
)
SELECT u.admin_user_id, u.primary_display_name_language, u.display_name
FROM vetchium.admin_users AS u
JOIN seeded_admins AS s USING (email_address)
ON CONFLICT (admin_user_id, language_code) DO NOTHING;

INSERT INTO vetchium.admin_permissions (admin_user_id, permission)
SELECT u.admin_user_id, granted.permission
FROM vetchium.admin_users AS u
JOIN seeded_admins AS s USING (email_address)
CROSS JOIN LATERAL unnest(s.permissions) AS granted (permission)
ON CONFLICT (admin_user_id, permission) DO NOTHING;
