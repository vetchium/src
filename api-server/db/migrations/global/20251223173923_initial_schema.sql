-- +goose Up
-- Region enum
CREATE TYPE region AS ENUM (
    'ind1',
    'usa1',
    'deu1',
    'sgp1'
);

-- Hub user status enum
CREATE TYPE hub_user_status AS ENUM (
    'active',
    'disabled',
    'deleted'
);

-- Email address hashing algorithm enum
CREATE TYPE email_address_hashing_algorithm AS ENUM (
    'SHA-256'
);

-- Language enum (for preferred_language)
CREATE TYPE language AS ENUM (
    'en',
    'de',
    'hi',
    'ta'
);

-- Hub users table (global)
CREATE TABLE hub_users (
    hub_user_global_id UUID PRIMARY KEY NOT NULL,
    handle TEXT NOT NULL UNIQUE,
    email_address_hash BYTEA NOT NULL UNIQUE,
    hashing_algorithm email_address_hashing_algorithm NOT NULL,
    status hub_user_status NOT NULL,
    preferred_language language NOT NULL,
    home_region region NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- +goose Down
DROP TABLE IF EXISTS hub_users;
DROP TYPE IF EXISTS language;
DROP TYPE IF EXISTS email_address_hashing_algorithm;
DROP TYPE IF EXISTS hub_user_status;
DROP TYPE IF EXISTS region;
