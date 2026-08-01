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
INSERT INTO vetchium.admin_users (email_address, display_name, password_hash, admin_user_state) VALUES
    ('admin@deu.example', 'deu Administrator', '$2a$10$r43DzlK2Kl9W9kvE6DfAkegUKSJd0g7ZiuOFi3Ozzcem5V83lLsUC', 'active')
ON CONFLICT (email_address) DO NOTHING;
