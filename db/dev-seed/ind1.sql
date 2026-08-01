-- Local-development fixtures for the "ind1" tenant.

INSERT INTO vetchium.orgs (name) VALUES
    ('ind1_org_1'),
    ('ind1_org_2')
ON CONFLICT (name) DO NOTHING;

INSERT INTO vetchium.hub_users (username, org_id)
SELECT v.username, o.id
FROM (VALUES
    ('ind1_user_1', 'ind1_org_1'),
    ('ind1_user_2', 'ind1_org_2')
) AS v (username, org_name)
JOIN vetchium.orgs o ON o.name = v.org_name
ON CONFLICT (username) DO NOTHING;
