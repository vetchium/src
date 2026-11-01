-- Creates the region's first administrator unless the address exists, so a
-- redeploy never undoes what administrators changed since. The grant covers
-- every permission that no other permission implies; together they confer all.
WITH created AS (
    INSERT INTO vetchium.admin_users (email_address, display_name, password_hash)
    VALUES (:'email', :'name', :'hash')
    ON CONFLICT (email_address) DO NOTHING
    RETURNING admin_user_id
)
INSERT INTO vetchium.admin_permissions (admin_user_id, permission)
SELECT created.admin_user_id, c.permission
FROM created
CROSS JOIN vetchium.admin_permission_catalog AS c
WHERE NOT EXISTS (
    SELECT 1 FROM vetchium.admin_permission_implications AS i
    WHERE i.implied_permission = c.permission
);
