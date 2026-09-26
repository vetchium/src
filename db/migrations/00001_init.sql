-- +goose Up

-- The bootstrap creates this schema and establishes its privileges before
-- Goose runs. Keeping the idempotent declaration here also makes the migration
-- a complete schema source for tools such as sqlc.
CREATE SCHEMA IF NOT EXISTS vetchium;

CREATE DOMAIN vetchium.hub_frontend_locale AS text
CHECK (VALUE IN ('en-US', 'ta', 'de-DE'));

CREATE DOMAIN vetchium.admin_frontend_locale AS text
CHECK (VALUE IN ('en-US', 'ta', 'de-DE'));

CREATE DOMAIN vetchium.profile_domain AS text
CHECK (
    VALUE = lower(btrim(VALUE)) AND
    char_length(VALUE) BETWEEN 3 AND 253 AND
    VALUE ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' AND
    VALUE !~ '^[0-9]+(\.[0-9]+){3}$'
);

-- A CHECK constraint may not contain a subquery, so set-returning checks are
-- wrapped in an immutable function instead. Immutability is what lets the
-- planner use it in a constraint at all.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vetchium.array_is_distinct(elements text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
    SELECT cardinality(elements) = (
        SELECT count(DISTINCT element) FROM unnest(elements) AS element
    );
$$;
-- +goose StatementEnd

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
	'provisioning',
    'active',
    'disabled'
);

-- Plan OIDs, identical in every tenant. Ranks live only in the TypeSpec
-- contract so there is one authority for ordering.
CREATE TABLE vetchium.hub_plans (
    hub_plan_oid text PRIMARY KEY
        CHECK (hub_plan_oid ~ '^hub-[a-z0-9]+(-[a-z0-9]+)*$')
);

INSERT INTO vetchium.hub_plans (hub_plan_oid)
VALUES ('hub-free-tier'), ('hub-silver-tier');

CREATE TYPE vetchium.hub_billing_interval AS ENUM ('month', 'year');
CREATE TYPE vetchium.hub_subscription_source AS ENUM ('simulated');

CREATE TABLE vetchium.hub_users (
    hub_user_did uuid PRIMARY KEY,
    handle text NOT NULL,
    email_address text NOT NULL,
    display_name text NOT NULL,
    biography text,
    profile_alias text,
    alias_last_changed_at timestamptz,
    profile_version bigint NOT NULL DEFAULT 1,
    password_hash text NOT NULL,
    hub_user_state vetchium.hub_user_state NOT NULL DEFAULT 'active',
    preferred_language vetchium.hub_frontend_locale NOT NULL DEFAULT 'en-US',
    resident_country text NOT NULL,
    preferred_job_countries text[] NOT NULL DEFAULT '{}',
    CONSTRAINT hub_users_job_countries_check CHECK (
        cardinality(preferred_job_countries) <= 10 AND
        array_position(preferred_job_countries, NULL) IS NULL AND
        vetchium.array_is_distinct(preferred_job_countries)
    ),
    totp_secret_ciphertext bytea,
    totp_enabled boolean NOT NULL DEFAULT false,
    totp_last_timestep bigint,
    last_login_at timestamptz,
    hub_plan_oid text NOT NULL REFERENCES vetchium.hub_plans (hub_plan_oid),
    subscription_billing_interval vetchium.hub_billing_interval,
    subscription_anchor_at timestamptz,
    subscription_period_start timestamptz,
    subscription_period_end timestamptz,
    scheduled_hub_plan_oid text REFERENCES vetchium.hub_plans (hub_plan_oid),
    scheduled_billing_interval vetchium.hub_billing_interval,
    subscription_cancels_at_period_end boolean NOT NULL GENERATED ALWAYS AS (
        COALESCE(scheduled_hub_plan_oid = 'hub-free-tier', false)
    ) STORED,
    subscription_source vetchium.hub_subscription_source NOT NULL
        DEFAULT 'simulated',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT hub_users_handle_key UNIQUE (handle),
    CONSTRAINT hub_users_email_address_key UNIQUE (email_address),
    CONSTRAINT hub_users_did_uuidv7_check CHECK (
        substring(hub_user_did::text FROM 15 FOR 1) = '7'
    ),
    CONSTRAINT hub_users_handle_check CHECK (
        handle ~ '^[a-z0-9]{8}-[0-9a-hjkmnp-tv-z]{11}$'
    ),
    CONSTRAINT hub_users_email_address_normalized CHECK (
        email_address = lower(btrim(email_address)) AND
        length(email_address) > 0
    ),
    CONSTRAINT hub_users_display_name_check CHECK (
        display_name = btrim(display_name) AND
        length(btrim(display_name)) BETWEEN 1 AND 200
    ),
    CONSTRAINT hub_users_biography_check CHECK (
        biography IS NULL OR (
            biography = btrim(biography) AND
            char_length(biography) BETWEEN 1 AND 2000
        )
    ),
    CONSTRAINT hub_users_profile_alias_key UNIQUE (profile_alias),
    CONSTRAINT hub_users_profile_alias_check CHECK (
        profile_alias IS NULL OR (
            char_length(profile_alias) BETWEEN 3 AND 30 AND
            profile_alias ~ '^[a-z][a-z0-9-]*[a-z0-9]$' AND
            profile_alias !~ '--' AND
            profile_alias !~ '^[a-z0-9]{8}-[0-9a-hjkmnp-tv-z]{11}$' AND
            profile_alias NOT IN (
                'api', 'admin', 'auth', 'help', 'jobs', 'login', 'logout',
                'media', 'org', 'privacy', 'settings', 'signup', 'support',
                'terms', 'u'
            )
        )
    ),
    CONSTRAINT hub_users_profile_version_check CHECK (profile_version > 0),
    CONSTRAINT hub_users_password_hash_not_blank CHECK (
        length(password_hash) > 0
    ),
    CONSTRAINT hub_users_resident_country_check CHECK (
        resident_country ~ '^[A-Z]{2}$'
    ),
    CONSTRAINT hub_users_totp_consistent CHECK (
        totp_enabled = (totp_secret_ciphertext IS NOT NULL)
    ),
    CONSTRAINT hub_users_timestamps_ordered CHECK (
        updated_at >= created_at
    ),
    -- Two explicit branches, so a partially null row cannot pass as SQL
    -- UNKNOWN.
    CONSTRAINT hub_users_free_plan_has_no_period CHECK (
        (hub_plan_oid = 'hub-free-tier'
            AND subscription_billing_interval IS NULL
            AND subscription_anchor_at IS NULL
            AND subscription_period_start IS NULL
            AND subscription_period_end IS NULL)
        OR (hub_plan_oid <> 'hub-free-tier'
            AND subscription_billing_interval IS NOT NULL
            AND subscription_anchor_at IS NOT NULL
            AND subscription_period_start IS NOT NULL
            AND subscription_period_end IS NOT NULL)
    ),
    -- On a free row every operand is null, so the expression is UNKNOWN and
    -- the row passes; the presence constraint above governs free rows. On a
    -- paid row that constraint makes every operand non-null, so this
    -- comparison is always determined.
    CONSTRAINT hub_users_subscription_period_ordered CHECK (
        subscription_anchor_at <= subscription_period_start
        AND subscription_period_start < subscription_period_end
    ),
    -- Three explicit, null-determined branches: no schedule; a scheduled
    -- cancellation on a paid plan; a scheduled paid change on a paid plan
    -- that differs from the current plan and interval.
    CONSTRAINT hub_users_scheduled_plan_consistent CHECK (
        (scheduled_hub_plan_oid IS NULL
            AND scheduled_billing_interval IS NULL)
        OR (scheduled_hub_plan_oid IS NOT NULL
            AND scheduled_hub_plan_oid = 'hub-free-tier'
            AND scheduled_billing_interval IS NULL
            AND hub_plan_oid <> 'hub-free-tier')
        OR (scheduled_hub_plan_oid IS NOT NULL
            AND scheduled_hub_plan_oid <> 'hub-free-tier'
            AND scheduled_billing_interval IS NOT NULL
            AND hub_plan_oid <> 'hub-free-tier'
            AND (scheduled_hub_plan_oid, scheduled_billing_interval)
                IS DISTINCT FROM (hub_plan_oid, subscription_billing_interval))
    )
);

CREATE TYPE vetchium.hub_subscription_notice_lead AS ENUM ('seven_day', 'one_day');

-- One row per (user, period end, lead time) ever warned. The unique
-- constraint is what makes a warning idempotent under a retried or repeated
-- worker tick: the insert is attempted with ON CONFLICT DO NOTHING rather
-- than guarded by a preceding read.
CREATE TABLE vetchium.hub_subscription_expiry_notices (
    hub_subscription_expiry_notice_id uuid PRIMARY KEY
        DEFAULT gen_random_uuid(),
    hub_user_did uuid NOT NULL REFERENCES vetchium.hub_users (hub_user_did)
        ON DELETE CASCADE,
    period_end timestamptz NOT NULL,
    lead_time vetchium.hub_subscription_notice_lead NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT hub_subscription_expiry_notices_key UNIQUE (
        hub_user_did, period_end, lead_time
    )
);

CREATE TYPE vetchium.hub_profile_picture_format AS ENUM ('jpeg', 'png');
CREATE TYPE vetchium.hub_profile_picture_state AS ENUM (
    'uploading',
    'active',
    'pending_delete'
);

CREATE TABLE vetchium.hub_profile_picture_objects (
    object_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hub_user_did uuid NOT NULL REFERENCES vetchium.hub_users (hub_user_did)
        ON DELETE CASCADE,
    format vetchium.hub_profile_picture_format NOT NULL,
    byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 8388608),
    width integer NOT NULL CHECK (width BETWEEN 400 AND 7680),
    height integer NOT NULL CHECK (height BETWEEN 400 AND 7680),
    content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
    state vetchium.hub_profile_picture_state NOT NULL DEFAULT 'uploading',
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_token uuid,
    leased_until timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    upload_expires_at timestamptz,
    delete_requested_at timestamptz,
    CONSTRAINT hub_profile_picture_objects_dimensions_check CHECK (
        LEAST(width, height) <= 4320 AND
        width::bigint * height::bigint <= 33177600
    ),
    CONSTRAINT hub_profile_picture_objects_state_check CHECK (
        (state = 'uploading' AND upload_expires_at IS NOT NULL AND
            delete_requested_at IS NULL) OR
        (state = 'active' AND upload_expires_at IS NULL AND
            delete_requested_at IS NULL) OR
        (state = 'pending_delete' AND upload_expires_at IS NULL AND
            delete_requested_at IS NOT NULL)
    ),
    CONSTRAINT hub_profile_picture_objects_lease_check CHECK (
        (lease_token IS NULL) = (leased_until IS NULL)
    )
);

CREATE UNIQUE INDEX hub_profile_picture_objects_active_user_idx
    ON vetchium.hub_profile_picture_objects (hub_user_did)
    WHERE state = 'active';

CREATE UNIQUE INDEX hub_profile_picture_objects_uploading_user_idx
    ON vetchium.hub_profile_picture_objects (hub_user_did)
    WHERE state = 'uploading';

CREATE TABLE vetchium.hub_professional_emails (
    professional_email_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hub_user_did uuid NOT NULL REFERENCES vetchium.hub_users (hub_user_did)
        ON DELETE CASCADE,
    email_address text NOT NULL,
    domain vetchium.profile_domain NOT NULL,
    first_verified_at timestamptz,
    last_verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT hub_professional_emails_user_domain_key UNIQUE (
        hub_user_did, domain
    ),
    CONSTRAINT hub_professional_emails_user_address_key UNIQUE (
        hub_user_did, email_address
    ),
    CONSTRAINT hub_professional_emails_address_check CHECK (
        email_address = lower(btrim(email_address)) AND
        email_address LIKE '%@' || domain AND
        char_length(email_address) <= 320
    ),
    CONSTRAINT hub_professional_emails_verification_check CHECK (
        (first_verified_at IS NULL AND last_verified_at IS NULL) OR
        (first_verified_at IS NOT NULL AND
            last_verified_at >= first_verified_at)
    ),
    CONSTRAINT hub_professional_emails_timestamps_check CHECK (
        updated_at >= created_at
    )
);

CREATE TABLE vetchium.hub_professional_email_challenges (
    challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    professional_email_id uuid NOT NULL
        REFERENCES vetchium.hub_professional_emails (professional_email_id)
        ON DELETE CASCADE,
    code_hash bytea NOT NULL CHECK (octet_length(code_hash) = 32),
    attempt_count integer NOT NULL DEFAULT 0
        CHECK (attempt_count BETWEEN 0 AND 5),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    superseded_at timestamptz,
    CONSTRAINT hub_professional_email_challenges_expiry_check CHECK (
        expires_at > created_at
    ),
    CONSTRAINT hub_professional_email_challenges_result_check CHECK (
        NOT (consumed_at IS NOT NULL AND superseded_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX hub_professional_email_challenges_active_email_idx
    ON vetchium.hub_professional_email_challenges (professional_email_id)
    WHERE consumed_at IS NULL AND superseded_at IS NULL AND attempt_count < 5;

CREATE TABLE vetchium.hub_work_experiences (
    work_experience_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hub_user_did uuid NOT NULL REFERENCES vetchium.hub_users (hub_user_did)
        ON DELETE CASCADE,
    employer_domain vetchium.profile_domain NOT NULL,
    job_title text NOT NULL,
    start_month date NOT NULL,
    end_month date,
    location text,
    description text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT hub_work_experiences_title_check CHECK (
        job_title = btrim(job_title) AND char_length(job_title) BETWEEN 1 AND 200
    ),
    CONSTRAINT hub_work_experiences_location_check CHECK (
        location IS NULL OR (
            location = btrim(location) AND char_length(location) BETWEEN 1 AND 200
        )
    ),
    CONSTRAINT hub_work_experiences_description_check CHECK (
        description IS NULL OR (
            description = btrim(description) AND
            char_length(description) BETWEEN 1 AND 2000
        )
    ),
    CONSTRAINT hub_work_experiences_months_check CHECK (
        start_month >= DATE '1900-01-01' AND
        start_month = date_trunc('month', start_month)::date AND
        (end_month IS NULL OR (
            end_month >= start_month AND
            end_month = date_trunc('month', end_month)::date
        ))
    ),
    CONSTRAINT hub_work_experiences_timestamps_check CHECK (
        updated_at >= created_at
    )
);

CREATE TABLE vetchium.hub_certifications (
    certification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hub_user_did uuid NOT NULL REFERENCES vetchium.hub_users (hub_user_did)
        ON DELETE CASCADE,
    title text NOT NULL,
    credential_url text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT hub_certifications_title_check CHECK (
        title = btrim(title) AND char_length(title) BETWEEN 1 AND 200
    ),
    CONSTRAINT hub_certifications_url_check CHECK (
        char_length(credential_url) BETWEEN 9 AND 2048 AND
        credential_url ~ '^https://[^/?#@[:space:]]+(/[^#[:space:]]*)?$' AND
        credential_url !~ '[^ -~]'
    ),
    CONSTRAINT hub_certifications_timestamps_check CHECK (
        updated_at >= created_at
    )
);

CREATE TABLE vetchium.hub_websites (
    website_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hub_user_did uuid NOT NULL REFERENCES vetchium.hub_users (hub_user_did)
        ON DELETE CASCADE,
    website_url text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- The API stores the normalized form (lowercase scheme and host, no
    -- trailing slash without a query), so this uniqueness is per profile link.
    CONSTRAINT hub_websites_user_url_key UNIQUE (hub_user_did, website_url),
    CONSTRAINT hub_websites_url_check CHECK (
        char_length(website_url) BETWEEN 11 AND 2048 AND
        website_url ~ (
            '^https://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?' ||
            '(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+' ||
            '(:[0-9]{1,5})?(/[^#[:space:]]*)?$'
        ) AND
        website_url !~ '[^ -~]' AND
        website_url !~ '^[^?]*/$' AND
        website_url !~ '^https://[0-9]+(\.[0-9]+){3}(:[0-9]{1,5})?(/|$)'
    ),
    CONSTRAINT hub_websites_timestamps_check CHECK (
        updated_at >= created_at
    )
);

CREATE TYPE vetchium.hub_language_ability_kind AS ENUM (
    'speaking',
    'reading',
    'writing'
);

CREATE TABLE vetchium.hub_language_abilities (
    hub_user_did uuid NOT NULL REFERENCES vetchium.hub_users (hub_user_did)
        ON DELETE CASCADE,
    ability vetchium.hub_language_ability_kind NOT NULL,
    language_tag text NOT NULL CHECK (language_tag ~ '^[a-z]{2,3}$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (hub_user_did, ability, language_tag)
);

CREATE TABLE vetchium.hub_educational_qualifications (
    educational_qualification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hub_user_did uuid NOT NULL REFERENCES vetchium.hub_users (hub_user_did)
        ON DELETE CASCADE,
    institution_domain vetchium.profile_domain NOT NULL,
    degree text NOT NULL,
    title text,
    supporting_text text,
    start_month date,
    end_month date,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT hub_educational_qualifications_degree_check CHECK (
        degree = btrim(degree) AND char_length(degree) BETWEEN 1 AND 200
    ),
    CONSTRAINT hub_educational_qualifications_title_check CHECK (
        title IS NULL OR (
            title = btrim(title) AND char_length(title) BETWEEN 1 AND 200
        )
    ),
    CONSTRAINT hub_educational_qualifications_supporting_text_check CHECK (
        supporting_text IS NULL OR (
            supporting_text = btrim(supporting_text) AND
            char_length(supporting_text) BETWEEN 1 AND 249
        )
    ),
    CONSTRAINT hub_educational_qualifications_months_check CHECK (
        (start_month IS NULL OR (
            start_month >= DATE '1900-01-01' AND
            start_month = date_trunc('month', start_month)::date
        )) AND
        (end_month IS NULL OR (
            end_month >= DATE '1900-01-01' AND
            end_month = date_trunc('month', end_month)::date
        )) AND
        (start_month IS NULL OR end_month IS NULL OR end_month >= start_month)
    ),
    CONSTRAINT hub_educational_qualifications_timestamps_check CHECK (
        updated_at >= created_at
    )
);

-- Serialize bounded profile-entry inserts through the owner row. The API also
-- checks limits to return a useful problem, while these triggers preserve the
-- invariant under concurrent requests and non-HTTP maintenance paths.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION vetchium.enforce_hub_profile_entry_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    existing_count integer;
    maximum_count integer := TG_ARGV[0]::integer;
BEGIN
    PERFORM 1
    FROM vetchium.hub_users
    WHERE hub_user_did = NEW.hub_user_did
    FOR UPDATE;

    IF TG_NARGS = 2 AND TG_ARGV[1] = 'ability' THEN
        EXECUTE format(
            'SELECT count(*) FROM %I.%I WHERE hub_user_did = $1 AND ability = $2',
            TG_TABLE_SCHEMA,
            TG_TABLE_NAME
        ) INTO existing_count USING NEW.hub_user_did, NEW.ability;
    ELSE
        EXECUTE format(
            'SELECT count(*) FROM %I.%I WHERE hub_user_did = $1',
            TG_TABLE_SCHEMA,
            TG_TABLE_NAME
        ) INTO existing_count USING NEW.hub_user_did;
    END IF;

    IF existing_count >= maximum_count THEN
        RAISE EXCEPTION '% profile entry limit is %', TG_TABLE_NAME, maximum_count
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER hub_professional_emails_limit
BEFORE INSERT ON vetchium.hub_professional_emails
FOR EACH ROW EXECUTE FUNCTION vetchium.enforce_hub_profile_entry_limit('10');

CREATE TRIGGER hub_work_experiences_limit
BEFORE INSERT ON vetchium.hub_work_experiences
FOR EACH ROW EXECUTE FUNCTION vetchium.enforce_hub_profile_entry_limit('50');

CREATE TRIGGER hub_certifications_limit
BEFORE INSERT ON vetchium.hub_certifications
FOR EACH ROW EXECUTE FUNCTION vetchium.enforce_hub_profile_entry_limit('50');

CREATE TRIGGER hub_websites_limit
BEFORE INSERT ON vetchium.hub_websites
FOR EACH ROW EXECUTE FUNCTION vetchium.enforce_hub_profile_entry_limit('10');

CREATE TRIGGER hub_language_abilities_limit
BEFORE INSERT ON vetchium.hub_language_abilities
FOR EACH ROW EXECUTE FUNCTION
    vetchium.enforce_hub_profile_entry_limit('25', 'ability');

CREATE TRIGGER hub_educational_qualifications_limit
BEFORE INSERT ON vetchium.hub_educational_qualifications
FOR EACH ROW EXECUTE FUNCTION vetchium.enforce_hub_profile_entry_limit('30');

CREATE TYPE vetchium.federation_operation_state AS ENUM (
    'pending',
    'succeeded',
    'failed'
);

CREATE TABLE vetchium.federation_operations (
    operation_id uuid PRIMARY KEY,
    command_id uuid NOT NULL UNIQUE,
    kind text NOT NULL CHECK (length(btrim(kind)) BETWEEN 1 AND 100),
    target_authority text NOT NULL CHECK (
        target_authority = 'global-directory' OR
        target_authority ~ '^[a-z][a-z0-9]{2,15}$'
    ),
    aggregate_id text NOT NULL CHECK (length(btrim(aggregate_id)) > 0),
    owner_principal_type text NOT NULL CHECK (
        owner_principal_type IN ('hub_user', 'org_user', 'admin', 'system')
    ),
    owner_principal_id text NOT NULL CHECK (
        length(btrim(owner_principal_id)) BETWEEN 1 AND 100
    ),
    idempotency_key text NOT NULL,
    request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
    payload_bytes bytea NOT NULL,
    state vetchium.federation_operation_state NOT NULL DEFAULT 'pending',
    response_status integer,
    response_ciphertext bytea,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    expires_at timestamptz NOT NULL,
    CONSTRAINT federation_operations_idempotency_key UNIQUE (
        kind, aggregate_id, idempotency_key
    ),
    CONSTRAINT federation_operations_result_check CHECK (
        (state = 'pending' AND response_status IS NULL AND
            response_ciphertext IS NULL AND completed_at IS NULL) OR
        (state IN ('succeeded', 'failed') AND response_status IS NOT NULL AND
            response_ciphertext IS NOT NULL AND completed_at IS NOT NULL)
    ),
    CONSTRAINT federation_operations_timestamps_check CHECK (
        updated_at >= created_at AND expires_at > created_at
    )
);

CREATE TABLE vetchium.federation_command_ledger (
    command_id uuid PRIMARY KEY,
    source_tenant_id text NOT NULL
        CHECK (source_tenant_id ~ '^[a-z][a-z0-9]{2,15}$'),
    kind text NOT NULL CHECK (length(btrim(kind)) BETWEEN 1 AND 100),
    aggregate_id text NOT NULL CHECK (length(btrim(aggregate_id)) > 0),
    request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
    response_status integer NOT NULL CHECK (response_status BETWEEN 200 AND 599),
    response_body bytea NOT NULL,
    completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vetchium.federation_outbox (
    event_id uuid PRIMARY KEY,
    destination_tenant_id text NOT NULL
        CHECK (destination_tenant_id ~ '^[a-z][a-z0-9]{2,15}$'),
    kind text NOT NULL CHECK (length(btrim(kind)) BETWEEN 1 AND 100),
    aggregate_type text NOT NULL CHECK (length(btrim(aggregate_type)) > 0),
    aggregate_id text NOT NULL CHECK (length(btrim(aggregate_id)) > 0),
    aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
    payload jsonb NOT NULL,
    payload_digest bytea NOT NULL CHECK (octet_length(payload_digest) = 32),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_token uuid,
    leased_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz,
    failed_at timestamptz,
    last_error text,
    CONSTRAINT federation_outbox_lease_check CHECK (
        (lease_token IS NULL) = (leased_until IS NULL)
    ),
    CONSTRAINT federation_outbox_result_check CHECK (
        NOT (delivered_at IS NOT NULL AND failed_at IS NOT NULL)
    )
);

CREATE TABLE vetchium.federation_inbox (
    event_id uuid PRIMARY KEY,
    source_tenant_id text NOT NULL
        CHECK (source_tenant_id ~ '^[a-z][a-z0-9]{2,15}$'),
    kind text NOT NULL CHECK (length(btrim(kind)) BETWEEN 1 AND 100),
    aggregate_type text NOT NULL CHECK (length(btrim(aggregate_type)) > 0),
    aggregate_id text NOT NULL CHECK (length(btrim(aggregate_id)) > 0),
    aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
    payload_digest bytea NOT NULL CHECK (octet_length(payload_digest) = 32),
    received_at timestamptz NOT NULL DEFAULT now(),
    applied_at timestamptz NOT NULL DEFAULT now()
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
    preferred_language vetchium.hub_frontend_locale NOT NULL,
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
    CONSTRAINT hub_signup_requests_country_check CHECK (
        resident_country ~ '^[A-Z]{2}$'
    ),
    CONSTRAINT hub_signup_requests_expiry_check CHECK (
        expires_at > created_at
    )
);

CREATE UNIQUE INDEX hub_signup_requests_active_email_idx
    ON vetchium.hub_signup_requests (email_address) WHERE active;

CREATE TYPE vetchium.hub_signup_completion_state AS ENUM (
    'prepared',
    'reserved',
    'local_created',
    'completed',
    'failed'
);

-- This is the origin-side durable operation for the global directory signup
-- saga. The encrypted payload contains the data needed to finish creating the
-- local account after a process restart; command IDs never change once sent.
CREATE TABLE vetchium.hub_signup_completions (
    operation_id uuid PRIMARY KEY,
    hub_signup_request_id uuid NOT NULL UNIQUE,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    idempotency_key text NOT NULL,
    request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
    hub_user_did uuid NOT NULL UNIQUE,
    handle text NOT NULL,
    reserve_command_id uuid NOT NULL UNIQUE,
    activate_command_id uuid NOT NULL UNIQUE,
    payload_ciphertext bytea NOT NULL,
    state vetchium.hub_signup_completion_state NOT NULL DEFAULT 'prepared',
    provisioning_expires_at timestamptz NOT NULL,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    expires_at timestamptz NOT NULL,
    CONSTRAINT hub_signup_completions_did_uuidv7_check CHECK (
        substring(hub_user_did::text FROM 15 FOR 1) = '7'
    ),
    CONSTRAINT hub_signup_completions_handle_check CHECK (
        handle ~ '^[a-z0-9]{8}-[0-9a-hjkmnp-tv-z]{11}$'
    ),
    CONSTRAINT hub_signup_completions_times_check CHECK (
        updated_at >= created_at
        AND provisioning_expires_at > created_at
        AND expires_at > provisioning_expires_at
        AND ((state IN ('completed', 'failed')) = (completed_at IS NOT NULL))
    )
);

CREATE INDEX hub_signup_completions_recovery_idx
    ON vetchium.hub_signup_completions (next_attempt_at, created_at)
    WHERE state NOT IN ('completed', 'failed');

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

-- A code proving control of a proposed new account address. It is bound to the
-- recently authenticated session that asked for it, so another session of the
-- same user cannot finish the change.
CREATE TABLE vetchium.hub_email_change_challenges (
    challenge_id uuid PRIMARY KEY,
    hub_user_did uuid NOT NULL REFERENCES vetchium.hub_users (hub_user_did)
        ON DELETE CASCADE,
    hub_session_id uuid NOT NULL
        REFERENCES vetchium.hub_sessions (hub_session_id) ON DELETE CASCADE,
    new_email_address text NOT NULL,
    code_hash bytea NOT NULL CHECK (octet_length(code_hash) = 32),
    attempt_count integer NOT NULL DEFAULT 0
        CHECK (attempt_count BETWEEN 0 AND 5),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    superseded_at timestamptz,
    CONSTRAINT hub_email_change_challenges_address_check CHECK (
        new_email_address = lower(btrim(new_email_address)) AND
        char_length(new_email_address) BETWEEN 3 AND 254
    ),
    CONSTRAINT hub_email_change_challenges_expiry_check CHECK (
        expires_at > created_at
    ),
    CONSTRAINT hub_email_change_challenges_result_check CHECK (
        NOT (consumed_at IS NOT NULL AND superseded_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX hub_email_change_challenges_active_user_idx
    ON vetchium.hub_email_change_challenges (hub_user_did)
    WHERE consumed_at IS NULL AND superseded_at IS NULL AND attempt_count < 5;

CREATE TABLE vetchium.hub_email_outbox (
    hub_email_outbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL CHECK (kind IN (
        'signup',
        'password-reset',
        'professional-email-verification',
        'subscription-ending',
        'email-change-verification',
        'email-changed'
    )),
    recipient_email_address text NOT NULL,
    preferred_language vetchium.hub_frontend_locale NOT NULL,
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
    preferred_language vetchium.admin_frontend_locale NOT NULL DEFAULT 'en-US',
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
DROP TABLE IF EXISTS vetchium.federation_inbox;
DROP TABLE IF EXISTS vetchium.federation_outbox;
DROP TABLE IF EXISTS vetchium.federation_command_ledger;
DROP TABLE IF EXISTS vetchium.federation_operations;
DROP TYPE IF EXISTS vetchium.federation_operation_state;
DROP TABLE IF EXISTS vetchium.hub_email_outbox;
DROP TABLE IF EXISTS vetchium.hub_password_reset_tokens;
DROP TABLE IF EXISTS vetchium.hub_signup_completions;
DROP TYPE IF EXISTS vetchium.hub_signup_completion_state;
DROP TABLE IF EXISTS vetchium.hub_signup_requests;
DROP TABLE IF EXISTS vetchium.hub_totp_recovery_codes;
DROP TABLE IF EXISTS vetchium.hub_totp_enrollments;
DROP TABLE IF EXISTS vetchium.hub_login_challenges;
DROP TABLE IF EXISTS vetchium.hub_sessions;
DROP TABLE IF EXISTS vetchium.hub_educational_qualifications;
DROP TABLE IF EXISTS vetchium.hub_language_abilities;
DROP TYPE IF EXISTS vetchium.hub_language_ability_kind;
DROP TABLE IF EXISTS vetchium.hub_websites;
DROP TABLE IF EXISTS vetchium.hub_certifications;
DROP TABLE IF EXISTS vetchium.hub_work_experiences;
DROP TABLE IF EXISTS vetchium.hub_professional_email_challenges;
DROP TABLE IF EXISTS vetchium.hub_professional_emails;
DROP TABLE IF EXISTS vetchium.hub_profile_picture_objects;
DROP TYPE IF EXISTS vetchium.hub_profile_picture_state;
DROP TYPE IF EXISTS vetchium.hub_profile_picture_format;
DROP TABLE IF EXISTS vetchium.hub_subscription_expiry_notices;
DROP TYPE IF EXISTS vetchium.hub_subscription_notice_lead;
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
DROP TYPE IF EXISTS vetchium.hub_subscription_source;
DROP TYPE IF EXISTS vetchium.hub_billing_interval;
DROP TABLE IF EXISTS vetchium.hub_plans;
DROP TYPE IF EXISTS vetchium.hub_user_state;
DROP TABLE IF EXISTS vetchium.audit_events;
DROP TABLE IF EXISTS vetchium.orgs;
DROP DOMAIN IF EXISTS vetchium.admin_frontend_locale;
DROP DOMAIN IF EXISTS vetchium.hub_frontend_locale;
DROP DOMAIN IF EXISTS vetchium.profile_domain;
DROP FUNCTION IF EXISTS vetchium.enforce_hub_profile_entry_limit();
DROP FUNCTION IF EXISTS vetchium.array_is_distinct(text[]);
