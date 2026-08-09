-- +goose Up

ALTER TABLE vetchium.admin_users
    ADD COLUMN is_superadmin boolean NOT NULL DEFAULT false,
    ADD COLUMN primary_display_name_language text NOT NULL DEFAULT 'en-US',
    ADD COLUMN preferred_language text,
    ADD COLUMN preferred_timezone text,
    ADD COLUMN totp_secret_ciphertext bytea,
    ADD COLUMN totp_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN totp_last_timestep bigint,
    ADD CONSTRAINT admin_users_preferred_language_check CHECK (
        preferred_language IS NULL OR
        preferred_language IN ('en-US', 'de-DE', 'ta-IN')
    ),
    ADD CONSTRAINT admin_users_totp_consistent CHECK (
        totp_enabled = (totp_secret_ciphertext IS NOT NULL)
    );

-- A single legacy administrator is unambiguous and remains the bootstrap
-- superadmin. Multiple legacy administrators are deliberately left without
-- an implicit elevation; operators select one using the documented bootstrap
-- transaction in db/README.md after this schema migration completes.
UPDATE vetchium.admin_users
SET is_superadmin = true
WHERE (SELECT count(*) FROM vetchium.admin_users) = 1;

CREATE TABLE vetchium.admin_company_settings (
    singleton        boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    default_language text    NOT NULL DEFAULT 'en-US' CHECK (
        default_language IN ('en-US', 'de-DE', 'ta-IN')
    ),
    default_timezone text    NOT NULL DEFAULT 'Etc/UTC',
    updated_at       timestamptz NOT NULL DEFAULT now()
);

INSERT INTO vetchium.admin_company_settings (singleton) VALUES (true);

CREATE TABLE vetchium.admin_display_names (
    admin_user_id uuid NOT NULL REFERENCES vetchium.admin_users (admin_user_id)
        ON DELETE CASCADE,
    language_code text NOT NULL,
    display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
    PRIMARY KEY (admin_user_id, language_code)
);

INSERT INTO vetchium.admin_display_names (
    admin_user_id,
    language_code,
    display_name
)
SELECT admin_user_id, 'en-US', display_name
FROM vetchium.admin_users;

CREATE TABLE vetchium.admin_permissions (
    admin_user_id uuid NOT NULL REFERENCES vetchium.admin_users (admin_user_id)
        ON DELETE CASCADE,
    permission text NOT NULL CHECK (
        permission IN ('admin:view_users', 'admin:manage_users')
    ),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (admin_user_id, permission)
);

-- Preserve the real authentication age of sessions created by migration 00001.
-- Adding this column with a now() default would incorrectly make every legacy
-- session recent for the security-sensitive five-minute reauthentication gate.
ALTER TABLE vetchium.admin_sessions
    ADD COLUMN authenticated_at timestamptz,
    ADD COLUMN last_totp_timestep bigint;

UPDATE vetchium.admin_sessions
SET authenticated_at = created_at;

ALTER TABLE vetchium.admin_sessions
    ALTER COLUMN authenticated_at SET NOT NULL,
    ALTER COLUMN authenticated_at SET DEFAULT now();

CREATE TABLE vetchium.admin_login_challenges (
    admin_login_challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id uuid NOT NULL REFERENCES vetchium.admin_users (admin_user_id)
        ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT admin_login_challenges_expiry_check CHECK (expires_at > created_at)
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
    CONSTRAINT admin_totp_enrollments_expiry_check CHECK (expires_at > created_at)
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
    invited_by uuid NOT NULL REFERENCES vetchium.admin_users (admin_user_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT admin_invitations_expiry_check CHECK (expires_at > created_at)
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

-- The outbox payload is encrypted by the API before insertion. A future mail
-- worker can atomically claim and decrypt these rows without storing tokens in
-- plaintext.
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

CREATE TABLE vetchium.admin_idempotency_ledger (
    operation text NOT NULL,
    binding_id text NOT NULL,
    idempotency_key text NOT NULL,
    request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
    response_status integer,
    response_ciphertext bytea,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (operation, binding_id, idempotency_key),
    CONSTRAINT admin_idempotency_response_consistent CHECK (
        (response_status IS NULL) = (response_ciphertext IS NULL)
    ),
    CONSTRAINT admin_idempotency_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX admin_idempotency_expiry_idx
    ON vetchium.admin_idempotency_ledger (expires_at);

-- +goose Down
DROP TABLE IF EXISTS vetchium.admin_idempotency_ledger;
DROP TABLE IF EXISTS vetchium.admin_email_outbox;
DROP TABLE IF EXISTS vetchium.admin_password_reset_tokens;
DROP TABLE IF EXISTS vetchium.admin_invitations;
DROP TABLE IF EXISTS vetchium.admin_totp_recovery_codes;
DROP TABLE IF EXISTS vetchium.admin_totp_enrollments;
DROP TABLE IF EXISTS vetchium.admin_login_challenges;
ALTER TABLE vetchium.admin_sessions
    DROP COLUMN IF EXISTS last_totp_timestep,
    DROP COLUMN IF EXISTS authenticated_at;
DROP TABLE IF EXISTS vetchium.admin_permissions;
DROP TABLE IF EXISTS vetchium.admin_display_names;
DROP TABLE IF EXISTS vetchium.admin_company_settings;
ALTER TABLE vetchium.admin_users
    DROP CONSTRAINT IF EXISTS admin_users_totp_consistent,
    DROP CONSTRAINT IF EXISTS admin_users_preferred_language_check,
    DROP COLUMN IF EXISTS totp_last_timestep,
    DROP COLUMN IF EXISTS totp_enabled,
    DROP COLUMN IF EXISTS totp_secret_ciphertext,
    DROP COLUMN IF EXISTS preferred_timezone,
    DROP COLUMN IF EXISTS preferred_language,
    DROP COLUMN IF EXISTS primary_display_name_language,
    DROP COLUMN IF EXISTS is_superadmin;
