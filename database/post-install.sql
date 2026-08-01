-- Database-level setup for a Vetchium tenant. Run as the database owner after
-- application migrations. This file is intentionally outside migrations: it
-- manages roles and access policy rather than versioned application schema.
--
-- The script is safe to rerun. Reapplying it reconciles access for existing
-- objects and rotates the application password to APP_POSTGRES_PASSWORD.

\getenv app_password APP_POSTGRES_PASSWORD

BEGIN;

SELECT format('CREATE ROLE %I LOGIN', 'vetchium_app')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vetchium_app')
\gexec

SELECT format(
    'ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
    'vetchium_app',
    :'app_password'
)
\gexec

-- Runtime services may use application objects, but cannot create or own them.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM vetchium_app;
GRANT USAGE ON SCHEMA public TO vetchium_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vetchium_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vetchium_app;

-- Goose's bookkeeping is deployment metadata, not application data.
SELECT 'REVOKE ALL PRIVILEGES ON TABLE public.goose_db_version FROM vetchium_app'
WHERE to_regclass('public.goose_db_version') IS NOT NULL
\gexec

-- These defaults apply to objects created by the database owner that runs this
-- script, which is also the role used by the migration runner.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vetchium_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO vetchium_app;

COMMIT;
