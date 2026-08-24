-- +goose Up

-- The bootstrap creates this schema and establishes its privileges before
-- Goose runs. Keeping the idempotent declaration here also makes the migration
-- a complete schema source for tools such as sqlc.
CREATE SCHEMA IF NOT EXISTS vetchium;

CREATE TABLE vetchium.orgs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT orgs_name_key UNIQUE (name),
    CONSTRAINT orgs_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE TABLE vetchium.audit_events (
    audit_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    actor_type text NOT NULL,
    actor_id text,
    source text NOT NULL,
    idempotency_key text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT audit_events_names_not_blank CHECK (
        length(btrim(tenant_id)) > 0 AND
        length(btrim(action)) > 0 AND
        length(btrim(entity_type)) > 0 AND
        length(btrim(entity_id)) > 0 AND
        length(btrim(actor_type)) > 0 AND
        length(btrim(source)) > 0
    )
);

CREATE TYPE vetchium.hub_user_state AS ENUM (
    'active',
    'disabled'
);

CREATE TABLE vetchium.hub_users (
    hub_user_did uuid PRIMARY KEY,
    handle text NOT NULL,
    email_address text NOT NULL,
    display_name text NOT NULL,
    password_hash text NOT NULL,
    hub_user_state vetchium.hub_user_state NOT NULL DEFAULT 'active',
    preferred_language text NOT NULL DEFAULT 'en-US',
    resident_country text NOT NULL,
    totp_secret_ciphertext bytea,
    totp_enabled boolean NOT NULL DEFAULT false,
    totp_last_timestep bigint,
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT hub_users_handle_key UNIQUE (handle),
    CONSTRAINT hub_users_email_address_key UNIQUE (email_address),
    CONSTRAINT hub_users_did_uuidv7_check CHECK (
        substring(hub_user_did::text FROM 15 FOR 1) = '7'
    ),
    CONSTRAINT hub_users_handle_check CHECK (
        handle ~ '^[a-z0-9]{5}-[0-9a-hjkmnp-tv-z]{11}$'
    ),
    CONSTRAINT hub_users_email_address_normalized CHECK (
        email_address = lower(btrim(email_address)) AND
        length(email_address) > 0
    ),
    CONSTRAINT hub_users_display_name_check CHECK (
        display_name = btrim(display_name) AND
        length(btrim(display_name)) BETWEEN 1 AND 200
    ),
    CONSTRAINT hub_users_password_hash_not_blank CHECK (
        length(password_hash) > 0
    ),
    CONSTRAINT hub_users_preferred_language_check CHECK (
        preferred_language IN ('en-US', 'ta', 'de-DE')
    ),
    CONSTRAINT hub_users_resident_country_check CHECK (
        resident_country ~ '^[A-Z]{3}$'
    ),
    CONSTRAINT hub_users_totp_consistent CHECK (
        totp_enabled = (totp_secret_ciphertext IS NOT NULL)
    ),
    CONSTRAINT hub_users_timestamps_ordered CHECK (
        updated_at >= created_at
    )
);

CREATE TABLE vetchium.hub_sessions (
    hub_session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hub_user_did uuid NOT NULL REFERENCES vetchium.hub_users (hub_user_did)
        ON DELETE CASCADE,
    session_token_hash bytea NOT NULL UNIQUE
        CHECK (octet_length(session_token_hash) = 32),
    authenticated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    remembered boolean NOT NULL DEFAULT false,
    CONSTRAINT hub_sessions_expiry_check CHECK (expires_at > created_at),
    CONSTRAINT hub_sessions_authentication_check CHECK (
        authenticated_at >= created_at AND authenticated_at <= expires_at
    )
);

CREATE TABLE vetchium.hub_login_challenges (
    hub_login_challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hub_user_did uuid NOT NULL REFERENCES vetchium.hub_users (hub_user_did)
        ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    remembered boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT hub_login_challenges_expiry_check CHECK (
        expires_at > created_at
    )
);

CREATE UNIQUE INDEX hub_login_challenges_active_user_idx
    ON vetchium.hub_login_challenges (hub_user_did) WHERE active;

CREATE TABLE vetchium.hub_totp_enrollments (
    hub_totp_enrollment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hub_user_did uuid NOT NULL REFERENCES vetchium.hub_users (hub_user_did)
        ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    secret_ciphertext bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT hub_totp_enrollments_expiry_check CHECK (
        expires_at > created_at
    )
);

CREATE UNIQUE INDEX hub_totp_enrollments_active_user_idx
    ON vetchium.hub_totp_enrollments (hub_user_did) WHERE active;

CREATE TABLE vetchium.hub_totp_recovery_codes (
    hub_user_did uuid NOT NULL REFERENCES vetchium.hub_users (hub_user_did)
        ON DELETE CASCADE,
    code_hash bytea NOT NULL CHECK (octet_length(code_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    consumed_at timestamptz,
    PRIMARY KEY (hub_user_did, code_hash)
);

CREATE TABLE vetchium.hub_signup_requests (
    hub_signup_request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email_address text NOT NULL,
    display_name text NOT NULL,
    preferred_language text NOT NULL,
    resident_country text NOT NULL,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT hub_signup_requests_email_check CHECK (
        email_address = lower(btrim(email_address)) AND
        length(email_address) > 0
    ),
    CONSTRAINT hub_signup_requests_display_name_check CHECK (
        display_name = btrim(display_name) AND
        length(btrim(display_name)) BETWEEN 1 AND 200
    ),
    CONSTRAINT hub_signup_requests_language_check CHECK (
        preferred_language IN ('en-US', 'ta', 'de-DE')
    ),
    CONSTRAINT hub_signup_requests_country_check CHECK (
        resident_country ~ '^[A-Z]{3}$'
    ),
    CONSTRAINT hub_signup_requests_expiry_check CHECK (
        expires_at > created_at
    )
);

CREATE UNIQUE INDEX hub_signup_requests_active_email_idx
    ON vetchium.hub_signup_requests (email_address) WHERE active;

CREATE TABLE vetchium.hub_password_reset_tokens (
    hub_password_reset_token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hub_user_did uuid NOT NULL REFERENCES vetchium.hub_users (hub_user_did)
        ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT hub_password_reset_tokens_expiry_check CHECK (
        expires_at > created_at
    )
);

CREATE UNIQUE INDEX hub_password_reset_tokens_active_user_idx
    ON vetchium.hub_password_reset_tokens (hub_user_did) WHERE active;

CREATE TABLE vetchium.hub_email_outbox (
    hub_email_outbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL CHECK (kind IN ('signup', 'password-reset')),
    recipient_email_address text NOT NULL,
    preferred_language text NOT NULL CHECK (
        preferred_language IN ('en-US', 'ta', 'de-DE')
    ),
    payload_ciphertext bytea NOT NULL,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_token uuid,
    leased_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    failed_at timestamptz,
    CONSTRAINT hub_email_outbox_lease_consistent CHECK (
        (lease_token IS NULL) = (leased_until IS NULL)
    ),
    CONSTRAINT hub_email_outbox_result_consistent CHECK (
        NOT (sent_at IS NOT NULL AND failed_at IS NOT NULL)
    )
);

CREATE TYPE vetchium.admin_user_state AS ENUM (
    'active',
    'disabled'
);

CREATE TABLE vetchium.admin_users (
    admin_user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email_address text NOT NULL,
    display_name text NOT NULL,
    password_hash text NOT NULL,
    admin_user_state vetchium.admin_user_state NOT NULL DEFAULT 'active',
    preferred_language text NOT NULL DEFAULT 'en-US',
    totp_secret_ciphertext bytea,
    totp_enabled boolean NOT NULL DEFAULT false,
    totp_last_timestep bigint,
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT admin_users_email_address_key UNIQUE (email_address),
    CONSTRAINT admin_users_email_address_normalized CHECK (
        email_address = lower(btrim(email_address)) AND
        length(email_address) > 0
    ),
    CONSTRAINT admin_users_display_name_length CHECK (
        length(btrim(display_name)) BETWEEN 1 AND 200
    ),
    CONSTRAINT admin_users_password_hash_not_blank CHECK (
        length(password_hash) > 0
    ),
    CONSTRAINT admin_users_timestamps_ordered CHECK (
        updated_at >= created_at
    ),
    CONSTRAINT admin_users_preferred_language_check CHECK (
        preferred_language IN ('en-US', 'ta', 'de-DE')
    ),
    CONSTRAINT admin_users_totp_consistent CHECK (
        totp_enabled = (totp_secret_ciphertext IS NOT NULL)
    )
);

CREATE TABLE vetchium.admin_sessions (
    admin_session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id uuid NOT NULL REFERENCES vetchium.admin_users (admin_user_id)
        ON DELETE CASCADE,
    session_token_hash bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    authenticated_at timestamptz NOT NULL DEFAULT now(),
    last_totp_timestep bigint,
    CONSTRAINT admin_sessions_session_token_hash_key UNIQUE (
        session_token_hash
    ),
    CONSTRAINT admin_sessions_token_hash_length CHECK (
        octet_length(session_token_hash) = 32
    ),
    CONSTRAINT admin_sessions_expiry_after_creation CHECK (
        expires_at > created_at
    )
);

CREATE INDEX admin_sessions_expires_at_idx
    ON vetchium.admin_sessions (expires_at);

-- Reference data rather than a CHECK constraint so a new permission is one
-- inserted row instead of a constraint rewrite, and so grants, invitations and
-- implications can all be validated against one list.
CREATE TABLE vetchium.admin_permission_catalog (
    permission text PRIMARY KEY CHECK (permission LIKE 'admin:%')
);

INSERT INTO vetchium.admin_permission_catalog (permission)
VALUES
    ('admin:view_users'),
    ('admin:manage_users'),
    ('admin:view_hub_signup_domains'),
    ('admin:manage_hub_signup_domains');

-- A grant of permission also confers implied_permission. Implications are
-- resolved on read by vetchium.admin_effective_permissions and are never
-- stored as grants of their own.
CREATE TABLE vetchium.admin_permission_implications (
    permission text NOT NULL
        REFERENCES vetchium.admin_permission_catalog (permission),
    implied_permission text NOT NULL
        REFERENCES vetchium.admin_permission_catalog (permission),
    PRIMARY KEY (permission, implied_permission),
    CONSTRAINT admin_permission_implications_not_self CHECK (
        permission <> implied_permission
    )
);

INSERT INTO vetchium.admin_permission_implications (
    permission, implied_permission
)
VALUES
    ('admin:manage_users', 'admin:view_users'),
    ('admin:manage_hub_signup_domains', 'admin:view_hub_signup_domains');

CREATE TABLE vetchium.admin_permissions (
    admin_user_id uuid NOT NULL REFERENCES vetchium.admin_users (admin_user_id)
        ON DELETE CASCADE,
    permission text NOT NULL
        REFERENCES vetchium.admin_permission_catalog (permission),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (admin_user_id, permission)
);

-- One hop of implication is resolved. A chained implication would need a
-- recursive expansion here and in the contract's matching helper.
CREATE VIEW vetchium.admin_effective_permissions AS
SELECT p.admin_user_id, p.permission
FROM vetchium.admin_permissions AS p
UNION
SELECT p.admin_user_id, i.implied_permission
FROM vetchium.admin_permissions AS p
JOIN vetchium.admin_permission_implications AS i
    ON i.permission = p.permission;

CREATE TYPE vetchium.hub_signup_domain_state AS ENUM (
    'active',
    'disabled'
);

CREATE TABLE vetchium.hub_signup_domains (
    hub_signup_domain_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    domain text NOT NULL,
    hub_signup_domain_state vetchium.hub_signup_domain_state NOT NULL
        DEFAULT 'active',
    disabled_comment text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT hub_signup_domains_domain_key UNIQUE (domain),
    CONSTRAINT hub_signup_domains_domain_normalized CHECK (
        domain = lower(btrim(domain)) AND
        char_length(domain) BETWEEN 3 AND 253 AND
        domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' AND
        domain ~ '\.[a-z0-9-]*[a-z][a-z0-9-]*$'
    ),
    CONSTRAINT hub_signup_domains_disabled_comment_matches_state CHECK (
        (
            hub_signup_domain_state = 'active' AND
            disabled_comment IS NULL
        ) OR (
            hub_signup_domain_state = 'disabled' AND
            disabled_comment = btrim(disabled_comment) AND
            char_length(disabled_comment) BETWEEN 1 AND 500
        )
    ),
    CONSTRAINT hub_signup_domains_timestamps_ordered CHECK (
        updated_at >= created_at
    )
);

CREATE TABLE vetchium.admin_login_challenges (
    admin_login_challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id uuid NOT NULL REFERENCES vetchium.admin_users (admin_user_id)
        ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT admin_login_challenges_expiry_check CHECK (
        expires_at > created_at
    )
);

CREATE INDEX admin_login_challenges_expiry_idx
    ON vetchium.admin_login_challenges (expires_at);
CREATE INDEX admin_login_challenges_consumed_idx
    ON vetchium.admin_login_challenges (consumed_at)
    WHERE consumed_at IS NOT NULL;
CREATE UNIQUE INDEX admin_login_challenges_active_user_idx
    ON vetchium.admin_login_challenges (admin_user_id) WHERE active;

CREATE TABLE vetchium.admin_totp_enrollments (
    admin_totp_enrollment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id uuid NOT NULL REFERENCES vetchium.admin_users (admin_user_id)
        ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    secret_ciphertext bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT admin_totp_enrollments_expiry_check CHECK (
        expires_at > created_at
    )
);

CREATE INDEX admin_totp_enrollments_expiry_idx
    ON vetchium.admin_totp_enrollments (expires_at);
CREATE INDEX admin_totp_enrollments_consumed_idx
    ON vetchium.admin_totp_enrollments (consumed_at)
    WHERE consumed_at IS NOT NULL;
CREATE UNIQUE INDEX admin_totp_enrollments_active_user_idx
    ON vetchium.admin_totp_enrollments (admin_user_id) WHERE active;

CREATE TABLE vetchium.admin_totp_recovery_codes (
    admin_user_id uuid NOT NULL REFERENCES vetchium.admin_users (admin_user_id)
        ON DELETE CASCADE,
    code_hash bytea NOT NULL CHECK (octet_length(code_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    consumed_at timestamptz,
    PRIMARY KEY (admin_user_id, code_hash)
);

CREATE INDEX admin_totp_recovery_codes_consumed_idx
    ON vetchium.admin_totp_recovery_codes (consumed_at)
    WHERE consumed_at IS NOT NULL;

CREATE TABLE vetchium.admin_invitations (
    admin_invitation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email_address text NOT NULL CHECK (
        email_address = lower(btrim(email_address)) AND
        length(email_address) > 0
    ),
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    -- An array cannot carry a foreign key, so membership is enforced when the
    -- invitation is created and again when its grants are inserted.
    permissions text[] NOT NULL DEFAULT '{}'::text[],
    invited_by uuid NOT NULL REFERENCES vetchium.admin_users (admin_user_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT admin_invitations_expiry_check CHECK (
        expires_at > created_at
    )
);

CREATE INDEX admin_invitations_email_idx
    ON vetchium.admin_invitations (email_address, expires_at);
CREATE INDEX admin_invitations_expiry_idx
    ON vetchium.admin_invitations (expires_at);
CREATE INDEX admin_invitations_consumed_idx
    ON vetchium.admin_invitations (consumed_at)
    WHERE consumed_at IS NOT NULL;
CREATE UNIQUE INDEX admin_invitations_active_email_idx
    ON vetchium.admin_invitations (email_address) WHERE active;

CREATE TABLE vetchium.admin_password_reset_tokens (
    admin_password_reset_token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id uuid NOT NULL REFERENCES vetchium.admin_users (admin_user_id)
        ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT admin_password_reset_tokens_expiry_check CHECK (
        expires_at > created_at
    )
);

CREATE INDEX admin_password_reset_tokens_expiry_idx
    ON vetchium.admin_password_reset_tokens (expires_at);
CREATE INDEX admin_password_reset_tokens_consumed_idx
    ON vetchium.admin_password_reset_tokens (consumed_at)
    WHERE consumed_at IS NOT NULL;
CREATE UNIQUE INDEX admin_password_reset_tokens_active_user_idx
    ON vetchium.admin_password_reset_tokens (admin_user_id) WHERE active;

CREATE TABLE vetchium.admin_email_outbox (
    admin_email_outbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL CHECK (kind IN ('invitation', 'password-reset')),
    recipient_email_address text NOT NULL,
    payload_ciphertext bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz
);

CREATE INDEX admin_email_outbox_retention_idx
    ON vetchium.admin_email_outbox (kind, created_at);

CREATE TABLE vetchium.idempotency_ledger (
    operation text NOT NULL,
    binding_id text NOT NULL,
    idempotency_key text NOT NULL,
    request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
    response_status integer,
    response_ciphertext bytea,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (operation, binding_id, idempotency_key),
    CONSTRAINT idempotency_response_consistent CHECK (
        (response_status IS NULL) = (response_ciphertext IS NULL)
    ),
    CONSTRAINT idempotency_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX idempotency_expiry_idx
    ON vetchium.idempotency_ledger (expires_at);

-- +goose Down
DROP TABLE IF EXISTS vetchium.idempotency_ledger;
DROP TABLE IF EXISTS vetchium.hub_email_outbox;
DROP TABLE IF EXISTS vetchium.hub_password_reset_tokens;
DROP TABLE IF EXISTS vetchium.hub_signup_requests;
DROP TABLE IF EXISTS vetchium.hub_totp_recovery_codes;
DROP TABLE IF EXISTS vetchium.hub_totp_enrollments;
DROP TABLE IF EXISTS vetchium.hub_login_challenges;
DROP TABLE IF EXISTS vetchium.hub_sessions;
DROP TABLE IF EXISTS vetchium.admin_email_outbox;
DROP TABLE IF EXISTS vetchium.admin_password_reset_tokens;
DROP TABLE IF EXISTS vetchium.admin_invitations;
DROP TABLE IF EXISTS vetchium.admin_totp_recovery_codes;
DROP TABLE IF EXISTS vetchium.admin_totp_enrollments;
DROP TABLE IF EXISTS vetchium.admin_login_challenges;
DROP TABLE IF EXISTS vetchium.hub_signup_domains;
DROP TYPE IF EXISTS vetchium.hub_signup_domain_state;
DROP VIEW IF EXISTS vetchium.admin_effective_permissions;
DROP TABLE IF EXISTS vetchium.admin_permissions;
DROP TABLE IF EXISTS vetchium.admin_permission_implications;
DROP TABLE IF EXISTS vetchium.admin_permission_catalog;
DROP TABLE IF EXISTS vetchium.admin_sessions;
DROP TABLE IF EXISTS vetchium.admin_users;
DROP TYPE IF EXISTS vetchium.admin_user_state;
DROP TABLE IF EXISTS vetchium.hub_users;
DROP TYPE IF EXISTS vetchium.hub_user_state;
DROP TABLE IF EXISTS vetchium.audit_events;
DROP TABLE IF EXISTS vetchium.orgs;
