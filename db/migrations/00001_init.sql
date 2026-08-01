-- +goose Up

-- Identity columns are the SQL-standard replacement for SERIAL: they own their
-- sequence and reject accidental explicit inserts that would desynchronise it.
CREATE TABLE vetchium.orgs (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    -- Organization names are identifiers within one isolated tenant database.
    CONSTRAINT orgs_name_key UNIQUE (name),
    CONSTRAINT orgs_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE TABLE vetchium.hub_users (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username   text        NOT NULL,
    -- ON DELETE RESTRICT is explicit rather than implied: deleting an org that
    -- still has users should fail loudly instead of silently orphaning them.
    org_id     bigint      NOT NULL REFERENCES vetchium.orgs (id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT hub_users_username_key UNIQUE (username),
    CONSTRAINT hub_users_username_not_blank CHECK (length(btrim(username)) > 0)
);

-- Postgres does not index foreign keys automatically, so both "users of this
-- org" and the FK check on org deletion would be sequential scans without this.
CREATE INDEX hub_users_org_id_idx ON vetchium.hub_users (org_id);

-- +goose Down
DROP TABLE IF EXISTS vetchium.hub_users;
DROP TABLE IF EXISTS vetchium.orgs;
