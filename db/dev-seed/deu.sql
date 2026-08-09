-- Local-development fixtures for the "deu" tenant.

INSERT INTO vetchium.orgs (name) VALUES
    ('deu_org_1'),
    ('deu_org_2')
ON CONFLICT (name) DO NOTHING;

INSERT INTO vetchium.hub_users (username, org_id)
SELECT v.username, o.id
FROM (VALUES
    ('deu_user_1', 'deu_org_1'),
    ('deu_user_2', 'deu_org_2')
) AS v (username, org_name)
JOIN vetchium.orgs o ON o.name = v.org_name
ON CONFLICT (username) DO NOTHING;

-- Local-only administrator; credentials are documented in db/README.md.
INSERT INTO vetchium.admin_users (
    email_address,
    display_name,
    password_hash,
    admin_user_state,
    is_superadmin,
    primary_display_name_language
) VALUES (
    'admin@deu.example',
    'deu Administrator',
    '$2a$10$r43DzlK2Kl9W9kvE6DfAkegUKSJd0g7ZiuOFi3Ozzcem5V83lLsUC',
    'active',
    true,
    'en-US'
)
ON CONFLICT (email_address) DO UPDATE SET is_superadmin = true;

INSERT INTO vetchium.admin_display_names (admin_user_id, language_code, display_name)
SELECT admin_user_id, primary_display_name_language, display_name
FROM vetchium.admin_users
WHERE email_address = 'admin@deu.example'
ON CONFLICT (admin_user_id, language_code) DO NOTHING;
