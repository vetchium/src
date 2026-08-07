-- +goose Up

-- The bootstrap creates this schema and establishes its privileges before
-- Goose runs. Keeping the idempotent declaration here also makes the migration
-- a complete schema source for tools such as sqlc.
CREATE SCHEMA IF NOT EXISTS vetchium;

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

CREATE TYPE vetchium.admin_user_state AS ENUM (
    'active',
    'disabled'
);

CREATE TABLE vetchium.admin_users (
    admin_user_id    uuid                       PRIMARY KEY DEFAULT gen_random_uuid(),
    email_address    text                       NOT NULL,
    display_name     text                       NOT NULL,
    password_hash    text                       NOT NULL,
    admin_user_state vetchium.admin_user_state NOT NULL DEFAULT 'active',
    last_login_at    timestamptz,
    created_at       timestamptz                 NOT NULL DEFAULT now(),
    updated_at       timestamptz                 NOT NULL DEFAULT now(),

    CONSTRAINT admin_users_email_address_key UNIQUE (email_address),
    CONSTRAINT admin_users_email_address_normalized CHECK (
        email_address = lower(btrim(email_address)) AND length(email_address) > 0
    ),
    CONSTRAINT admin_users_display_name_not_blank CHECK (length(btrim(display_name)) > 0),
    CONSTRAINT admin_users_password_hash_not_blank CHECK (length(password_hash) > 0),
    CONSTRAINT admin_users_timestamps_ordered CHECK (updated_at >= created_at)
);

CREATE TABLE vetchium.admin_sessions (
    admin_session_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id      uuid        NOT NULL REFERENCES vetchium.admin_users (admin_user_id) ON DELETE CASCADE,
    session_token_hash bytea       NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL,

    -- Uniqueness is part of the session-token identity contract, not an
    -- additional performance index.
    CONSTRAINT admin_sessions_session_token_hash_key UNIQUE (session_token_hash),
    CONSTRAINT admin_sessions_token_hash_length CHECK (octet_length(session_token_hash) = 32),
    CONSTRAINT admin_sessions_expiry_after_creation CHECK (expires_at > created_at)
);

-- The expiry worker deletes by this range predicate every hour.
CREATE INDEX admin_sessions_expires_at_idx ON vetchium.admin_sessions (expires_at);

-- +goose Down
DROP TABLE IF EXISTS vetchium.admin_sessions;
DROP TABLE IF EXISTS vetchium.admin_users;
DROP TYPE IF EXISTS vetchium.admin_user_state;
DROP TABLE IF EXISTS vetchium.hub_users;
DROP TABLE IF EXISTS vetchium.orgs;
