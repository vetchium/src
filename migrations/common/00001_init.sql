-- +goose Up

-- Identity columns are the SQL-standard replacement for SERIAL: they own their
-- sequence and reject accidental explicit inserts that would desynchronise it.
CREATE TABLE orgs (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    -- The seed data looks orgs up by name, and a duplicate name is meaningless.
    CONSTRAINT orgs_name_key UNIQUE (name),
    CONSTRAINT orgs_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE TABLE hub_users (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username   text        NOT NULL,
    -- ON DELETE RESTRICT is explicit rather than implied: deleting an org that
    -- still has users should fail loudly instead of silently orphaning them.
    org_id     bigint      NOT NULL REFERENCES orgs (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT hub_users_username_key UNIQUE (username),
    CONSTRAINT hub_users_username_not_blank CHECK (length(btrim(username)) > 0)
);

-- Postgres does not index foreign keys automatically, so both "users of this
-- org" and the FK check on org deletion would be sequential scans without this.
CREATE INDEX hub_users_org_id_idx ON hub_users (org_id);

-- Runtime services connect as a role that may use existing schema objects but
-- cannot create or own them. Migrations continue to run as the PostgreSQL
-- administrator.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM vetchium_app;
GRANT USAGE ON SCHEMA public TO vetchium_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE orgs, hub_users TO vetchium_app;
GRANT USAGE, SELECT ON SEQUENCE orgs_id_seq, hub_users_id_seq TO vetchium_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vetchium_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO vetchium_app;

-- +goose Down
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM vetchium_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    REVOKE USAGE, SELECT ON SEQUENCES FROM vetchium_app;
REVOKE ALL PRIVILEGES ON TABLE orgs, hub_users FROM vetchium_app;
REVOKE ALL PRIVILEGES ON SEQUENCE orgs_id_seq, hub_users_id_seq FROM vetchium_app;
REVOKE USAGE ON SCHEMA public FROM vetchium_app;
DROP TABLE IF EXISTS hub_users;
DROP TABLE IF EXISTS orgs;
