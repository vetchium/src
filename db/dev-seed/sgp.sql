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
