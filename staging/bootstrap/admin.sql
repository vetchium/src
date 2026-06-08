-- Initial superadmin bootstrap (staging — and the same approach production uses,
-- since there is no code path that creates the first admin).
--
-- Creates exactly ONE superadmin from psql variables, hashing the password with
-- bcrypt via pgcrypto (compatible with the Go bcrypt verifier, $2a$10$...).
-- Idempotent: re-running does nothing if the admin already exists.
--
-- Invoked as:
--   psql ... -v admin_email='you@example.com' -v admin_password='...' -f admin.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

WITH ins AS (
    INSERT INTO admin_users (admin_user_id, email_address, password_hash, status)
    VALUES (
        gen_random_uuid(),
        :'admin_email',
        convert_to(crypt(:'admin_password', gen_salt('bf', 10)), 'UTF8'),
        'active'
    )
    ON CONFLICT DO NOTHING
    RETURNING admin_user_id
)
INSERT INTO admin_user_roles (admin_user_id, role_id)
SELECT ins.admin_user_id, r.role_id
FROM ins
CROSS JOIN roles r
WHERE r.role_name = 'admin:superadmin'
ON CONFLICT DO NOTHING;
