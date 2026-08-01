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
INSERT INTO vetchium.admin_users (email_address, display_name, password_hash, admin_user_state) VALUES
    ('admin@sgp.example', 'sgp Administrator', '$2a$10$r43DzlK2Kl9W9kvE6DfAkegUKSJd0g7ZiuOFi3Ozzcem5V83lLsUC', 'active')
ON CONFLICT (email_address) DO NOTHING;
