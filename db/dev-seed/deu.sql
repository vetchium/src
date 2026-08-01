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
