-- Executed once by the official PostgreSQL image after it creates POSTGRES_DB
-- and before the server is declared ready.
\getenv app_password POSTGRES_APP_PASSWORD

BEGIN;

CREATE ROLE vetchium_app
    LOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOREPLICATION
    PASSWORD :'app_password';

-- Application objects live outside public so migration metadata and any future
-- administrative objects do not accidentally become runtime-accessible.
CREATE SCHEMA vetchium;
REVOKE ALL ON SCHEMA vetchium FROM PUBLIC;
GRANT USAGE ON SCHEMA vetchium TO vetchium_app;

-- Avoid resolving untrusted objects through public for runtime connections.
ALTER ROLE vetchium_app SET search_path = pg_catalog, vetchium;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Migrations run as POSTGRES_USER, the same role executing this file. These
-- defaults therefore apply to future application objects created in vetchium.
ALTER DEFAULT PRIVILEGES IN SCHEMA vetchium
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vetchium_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA vetchium
    GRANT USAGE, SELECT ON SEQUENCES TO vetchium_app;

COMMIT;
