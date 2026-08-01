-- Test seed data for the "deu" tenant.
--
-- Applied by psql on every `docker compose up`, so it must be idempotent: the
-- ON CONFLICT clauses make a re-run a no-op instead of a unique violation.
-- The compose service runs psql with -v ON_ERROR_STOP=1 (so a failure fails the
-- container) and -1 (so the whole file is one transaction).

INSERT INTO orgs (name) VALUES
    ('deu_org_1'),
    ('deu_org_2')
ON CONFLICT (name) DO NOTHING;

-- org_id is resolved by name rather than hardcoded to 1 and 2, which would
-- break as soon as the identity sequence started anywhere but 1.
INSERT INTO hub_users (username, org_id)
SELECT v.username, o.id
FROM (VALUES
    ('deu_user_1', 'deu_org_1'),
    ('deu_user_2', 'deu_org_2')
) AS v (username, org_name)
JOIN orgs o ON o.name = v.org_name
ON CONFLICT (username) DO NOTHING;
