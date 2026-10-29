-- +goose Up

-- The bootstrap creates this schema and establishes its privileges before
-- Goose runs. Keeping the idempotent declaration here also makes the migration
-- a complete schema source for tools such as sqlc.
CREATE SCHEMA IF NOT EXISTS vetchium;

CREATE DOMAIN vetchium.hub_frontend_locale AS text
CHECK (VALUE IN ('en-US', 'ta', 'de-DE'));

CREATE DOMAIN vetchium.admin_frontend_locale AS text
CHECK (VALUE IN ('en-US', 'ta', 'de-DE'));

CREATE DOMAIN vetchium.org_frontend_locale AS text
CHECK (VALUE IN ('en-US', 'ta', 'de-DE'));

-- An exact, normalized domain an Org can claim: DNS syntax with a lettered
-- last label, so an IP address or numeric name can never be claimed.
CREATE DOMAIN vetchium.org_domain AS text
CHECK (
    VALUE = lower(btrim(VALUE)) AND
    char_length(VALUE) BETWEEN 3 AND 253 AND
    VALUE ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' AND
    VALUE ~ '\.[a-z0-9-]*[a-z][a-z0-9-]*$'
);

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

CREATE TABLE vetchium.audit_events (
    audit_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    actor_type text NOT NULL,
    actor_id text,
    -- Historical subjects survive deletion of temporary and application rows.
    subject_hub_user_did uuid,
    subject_org_did uuid,
    subject_org_user_ids uuid[] NOT NULL DEFAULT '{}',
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
    -- Keyed digest of email_address (GU-SIG-001), the same one the global
    -- directory holds a claim for; the key never reaches this database.
    email_digest bytea NOT NULL CHECK (octet_length(email_digest) = 32),
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
    -- "Agencies may message me" (MKT-CNV-006). Its version orders the state
    -- the agency tenants keep on their Contacts (MKT-DAT-006).
    agencies_may_message boolean NOT NULL DEFAULT true,
    agencies_may_message_version bigint NOT NULL DEFAULT 1
        CHECK (agencies_may_message_version >= 1),
    subscription_cancels_at_period_end boolean NOT NULL GENERATED ALWAYS AS (
        COALESCE(scheduled_hub_plan_oid = 'hub-free-tier', false)
    ) STORED,
    subscription_source vetchium.hub_subscription_source NOT NULL
        DEFAULT 'simulated',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT hub_users_handle_key UNIQUE (handle),
    CONSTRAINT hub_users_email_address_key UNIQUE (email_address),
    CONSTRAINT hub_users_email_digest_key UNIQUE (email_digest),
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
    -- 'tenant' commands go to the home tenant of the authority principal,
    -- re-resolved on every attempt, so no tenant id is stored.
    target_authority text NOT NULL CHECK (
        target_authority IN ('global-directory', 'tenant')
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
    authority_principal_type text CHECK (
        authority_principal_type IN ('hub_user', 'org')
    ),
    authority_principal_did uuid,
    CONSTRAINT federation_operations_authority_check CHECK (
        (target_authority = 'tenant' AND authority_principal_type IS NOT NULL
            AND authority_principal_did IS NOT NULL) OR
        (target_authority = 'global-directory'
            AND authority_principal_type IS NULL
            AND authority_principal_did IS NULL)
    ),
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

CREATE INDEX federation_operations_recoverable_commands_idx
    ON vetchium.federation_operations (next_attempt_at, created_at, operation_id)
    WHERE state = 'pending' AND target_authority = 'tenant';

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

-- Effects of committed authoritative changes, delivered at least once to the
-- home tenant of the destination principal, re-resolved on every attempt.
-- payload_bytes keeps the enqueued JSON byte for byte; jsonb would rewrite
-- it.
CREATE TABLE vetchium.federation_outbox (
    event_id uuid PRIMARY KEY,
    kind text NOT NULL CHECK (length(btrim(kind)) BETWEEN 1 AND 100),
    destination_principal_type text NOT NULL CHECK (
        destination_principal_type IN ('hub_user', 'org')
    ),
    destination_principal_did uuid NOT NULL,
    aggregate_type text NOT NULL CHECK (
        length(btrim(aggregate_type)) BETWEEN 1 AND 100
    ),
    aggregate_id text NOT NULL CHECK (
        length(btrim(aggregate_id)) BETWEEN 1 AND 200
    ),
    aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
    payload_bytes bytea NOT NULL,
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

CREATE INDEX federation_outbox_due_idx
    ON vetchium.federation_outbox (next_attempt_at, created_at, event_id)
    WHERE delivered_at IS NULL AND failed_at IS NULL;

-- One receipt per event ever received, so a redelivery is a no-op.
CREATE TABLE vetchium.federation_inbox (
    event_id uuid PRIMARY KEY,
    source_tenant_id text NOT NULL
        CHECK (source_tenant_id ~ '^[a-z][a-z0-9]{2,15}$'),
    kind text NOT NULL CHECK (length(btrim(kind)) BETWEEN 1 AND 100),
    aggregate_type text NOT NULL CHECK (length(btrim(aggregate_type)) > 0),
    aggregate_id text NOT NULL CHECK (length(btrim(aggregate_id)) > 0),
    aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
    payload_digest bytea NOT NULL CHECK (octet_length(payload_digest) = 32),
    -- false when a newer version of the aggregate had already been applied.
    applied boolean NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now()
);

-- The newest aggregate version applied per event kind and destination
-- principal, so an older event never overwrites newer state. Kind and
-- destination are part of the key because one aggregate change may feed
-- several projections.
CREATE TABLE vetchium.federation_event_watermarks (
    kind text NOT NULL CHECK (length(btrim(kind)) BETWEEN 1 AND 100),
    destination_principal_did uuid NOT NULL,
    aggregate_type text NOT NULL CHECK (length(btrim(aggregate_type)) > 0),
    aggregate_id text NOT NULL CHECK (length(btrim(aggregate_id)) > 0),
    aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (kind, destination_principal_did, aggregate_type, aggregate_id)
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
    -- Computed once at prepare time; also written to hub_users.email_digest
    -- when the local account is created (GU-SIG-004).
    account_email_digest bytea NOT NULL CHECK (
        octet_length(account_email_digest) = 32
    ),
    hub_user_did uuid NOT NULL UNIQUE,
    handle text NOT NULL,
    reserve_command_id uuid NOT NULL UNIQUE,
    activate_command_id uuid NOT NULL UNIQUE,
    payload_ciphertext bytea NOT NULL,
    state vetchium.hub_signup_completion_state NOT NULL DEFAULT 'prepared',
    failure_reason text CHECK (
        failure_reason IN ('expired', 'email_registered_elsewhere')
    ),
    -- Set only for the email_registered_elsewhere failure, and only when the
    -- coordinator's resolve-hub-account-email lookup itself succeeded.
    conflicting_home_tenant_id text CHECK (
        conflicting_home_tenant_id ~ '^[a-z][a-z0-9]{2,15}$'
    ),
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
    CONSTRAINT hub_signup_completions_failure_check CHECK (
        (state = 'failed') = (failure_reason IS NOT NULL)
    ),
    CONSTRAINT hub_signup_completions_conflicting_tenant_check CHECK (
        conflicting_home_tenant_id IS NULL
        OR failure_reason = 'email_registered_elsewhere'
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

CREATE TYPE vetchium.hub_account_email_change_state AS ENUM (
    'accepted', 'reserved', 'applied', 'cancelling', 'succeeded', 'failed'
);

-- The durable account-email-change saga (GU-ECH-002a). Independent of
-- hub_email_change_challenges, which cascades away with its session: logout
-- during a pending change must not destroy the address the change needs.
CREATE TABLE vetchium.hub_account_email_changes (
    operation_id uuid PRIMARY KEY
        REFERENCES vetchium.federation_operations (operation_id),
    hub_user_did uuid NOT NULL
        REFERENCES vetchium.hub_users (hub_user_did) ON DELETE CASCADE,
    new_email_address text NOT NULL,
    new_email_digest bytea NOT NULL CHECK (octet_length(new_email_digest) = 32),
    old_email_digest bytea NOT NULL CHECK (octet_length(old_email_digest) = 32),
    -- Deliberately no FK: the session may end while the change is pending.
    confirming_session_id uuid NOT NULL,
    state vetchium.hub_account_email_change_state NOT NULL DEFAULT 'accepted',
    failure_reason text CHECK (
        failure_reason IN ('address_unavailable', 'reservation_expired')
    ),
    reserve_command_id uuid NOT NULL UNIQUE,
    finalize_command_id uuid NOT NULL UNIQUE,
    abandon_command_id uuid NOT NULL UNIQUE,
    -- accepted_at + 24h; sent to the coordinator as the reservation deadline.
    not_after timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CONSTRAINT hub_account_email_changes_address_check CHECK (
        new_email_address = lower(btrim(new_email_address)) AND
        length(new_email_address) > 0
    ),
    CONSTRAINT hub_account_email_changes_completed_check CHECK (
        (state IN ('succeeded', 'failed')) = (completed_at IS NOT NULL)
    ),
    -- The reason is set on entering 'cancelling' and kept through 'failed'.
    CONSTRAINT hub_account_email_changes_failure_check CHECK (
        (state IN ('cancelling', 'failed')) = (failure_reason IS NOT NULL)
    ),
    CONSTRAINT hub_account_email_changes_timestamps_check CHECK (
        updated_at >= created_at
    )
);

CREATE UNIQUE INDEX hub_account_email_changes_one_live
    ON vetchium.hub_account_email_changes (hub_user_did)
    WHERE state NOT IN ('succeeded', 'failed');

CREATE TABLE vetchium.hub_email_outbox (
    hub_email_outbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL CHECK (kind IN (
        'signup',
        'signup-registered-elsewhere',
        'password-reset',
        'professional-email-verification',
        'subscription-ending',
        'email-change-verification',
        'email-changed',
        'application-status-changed',
        'application-interview-scheduled',
        'application-interview-changed',
        'application-interview-cancelled',
        'application-consent-requested',
        'application-offer-extended',
        'application-offer-withdrawn',
        'application-offer-expiring',
        'application-offer-expired',
        'agency-message-received'
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
    ('admin:view_audit_logs'),
    ('admin:view_users'),
    ('admin:manage_users'),
    ('admin:view_hub_signup_domains'),
    ('admin:manage_hub_signup_domains'),
    ('admin:view_ai_usage');

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

-- Plan OIDs, identical in every tenant.
CREATE TABLE vetchium.org_plans (
    org_plan_oid text PRIMARY KEY
        CHECK (org_plan_oid ~ '^org-[a-z0-9]+(-[a-z0-9]+)*$')
);

INSERT INTO vetchium.org_plans (org_plan_oid)
VALUES ('org-free-tier'), ('org-silver-tier'), ('org-gold-tier');

CREATE TYPE vetchium.pipeline_stage_kind AS ENUM (
    'review',
    'assessment',
    'interview',
    'background_check'
);

-- Capability OIDs, identical in every tenant. A stage Capability performs
-- stages of one kind; sourcing works on whole Openings, so it has none.
CREATE TABLE vetchium.capabilities (
    capability_oid text PRIMARY KEY
        CHECK (capability_oid ~ '^[a-z]+(_[a-z]+)*$'),
    performs_stage_kind vetchium.pipeline_stage_kind
);

INSERT INTO vetchium.capabilities (capability_oid, performs_stage_kind)
VALUES
    ('sourcing', NULL),
    ('interviewing', 'interview'),
    ('assessment', 'assessment'),
    ('background_check', 'background_check');

CREATE TYPE vetchium.org_billing_interval AS ENUM ('month', 'year');

CREATE TYPE vetchium.org_state AS ENUM (
    'provisioning',
    'active',
    'suspended'
);

CREATE TABLE vetchium.orgs (
    org_did uuid PRIMARY KEY,
    display_name text NOT NULL,
    -- Where the Org is based, which is not its tenant: a region hosts Orgs
    -- from many countries.
    country text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
    -- For mail addressed to the Org rather than to one of its users, and the
    -- starting language of a new Opening.
    default_language vetchium.org_frontend_locale NOT NULL,
    org_state vetchium.org_state NOT NULL DEFAULT 'provisioning',
    org_plan_oid text NOT NULL REFERENCES vetchium.org_plans (org_plan_oid),
    org_billing_interval vetchium.org_billing_interval,
    -- A superadmin's choice, honoured only on Gold. Leaving Gold clears it in
    -- the transition's own statement.
    google_sign_in_enabled boolean NOT NULL DEFAULT false,
    next_opening_number integer NOT NULL DEFAULT 1
        CHECK (next_opening_number >= 1),
    suspended_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT orgs_did_uuidv7_check CHECK (
        substring(org_did::text FROM 15 FOR 1) = '7'
    ),
    CONSTRAINT orgs_display_name_check CHECK (
        display_name = btrim(display_name) AND
        char_length(display_name) BETWEEN 1 AND 200
    ),
    CONSTRAINT orgs_suspension_check CHECK (
        (org_state = 'suspended') = (suspended_at IS NOT NULL)
    ),
    CONSTRAINT orgs_timestamps_ordered CHECK (updated_at >= created_at),
    CONSTRAINT orgs_plan_interval CHECK (
        (org_plan_oid = 'org-free-tier') = (org_billing_interval IS NULL)
    ),
    CONSTRAINT orgs_google_sign_in_is_gold CHECK (
        NOT google_sign_in_enabled OR org_plan_oid = 'org-gold-tier'
    )
);

-- verified and failing hold a global claim. releasing and reclaiming carry the
-- durable global command that moves the domain out of or back into the
-- directory; released holds no claim, but the Org keeps its record and token
-- so it can prove the domain again.
CREATE TYPE vetchium.org_domain_state AS ENUM (
    'verified',
    'failing',
    'releasing',
    'released',
    'reclaiming'
);

-- One domain per Org in this version, so the Org is the key. Allowing several
-- later needs a surrogate key and a primary-domain marker.
CREATE TABLE vetchium.org_domains (
    org_did uuid PRIMARY KEY REFERENCES vetchium.orgs (org_did)
        ON DELETE CASCADE,
    domain vetchium.org_domain NOT NULL,
    verification_token text NOT NULL
        CHECK (verification_token ~ '^[a-z2-7]{26}$'),
    domain_state vetchium.org_domain_state NOT NULL DEFAULT 'verified',
    last_verified_at timestamptz NOT NULL,
    last_conclusive_at timestamptz NOT NULL,
    consecutive_failures integer NOT NULL DEFAULT 0
        CHECK (consecutive_failures >= 0),
    consecutive_inconclusive integer NOT NULL DEFAULT 0
        CHECK (consecutive_inconclusive >= 0),
    next_check_at timestamptz NOT NULL,
    failing_since timestamptz,
    released_at timestamptz,
    directory_command_id uuid UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_domains_state_check CHECK (
        (domain_state = 'verified'
            AND failing_since IS NULL AND released_at IS NULL
            AND directory_command_id IS NULL)
        OR (domain_state = 'failing'
            AND failing_since IS NOT NULL AND released_at IS NULL
            AND directory_command_id IS NULL)
        OR (domain_state = 'releasing'
            AND failing_since IS NOT NULL AND released_at IS NULL
            AND directory_command_id IS NOT NULL)
        OR (domain_state = 'released'
            AND failing_since IS NULL AND released_at IS NOT NULL
            AND directory_command_id IS NULL)
        OR (domain_state = 'reclaiming'
            AND failing_since IS NULL AND released_at IS NOT NULL
            AND directory_command_id IS NOT NULL)
    ),
    CONSTRAINT org_domains_timestamps_ordered CHECK (updated_at >= created_at)
);

-- Mirrors the global one-owner invariant locally, so two Orgs of one tenant
-- can never both believe they hold a domain.
CREATE UNIQUE INDEX org_domains_claimed_domain_idx
    ON vetchium.org_domains (domain)
    WHERE domain_state <> 'released';

CREATE TYPE vetchium.org_user_state AS ENUM (
    'provisioning',
    'active',
    'disabled'
);

CREATE TABLE vetchium.org_users (
    org_user_id uuid PRIMARY KEY,
    org_did uuid NOT NULL REFERENCES vetchium.orgs (org_did)
        ON DELETE CASCADE,
    email_address text NOT NULL,
    org_user_state vetchium.org_user_state NOT NULL DEFAULT 'provisioning',
    disabled_at timestamptz,
    disabled_by uuid REFERENCES vetchium.org_users (org_user_id)
        ON DELETE SET NULL,
    preferred_language vetchium.org_frontend_locale NOT NULL,
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_users_org_email_key UNIQUE (org_did, email_address),
    CONSTRAINT org_users_disabled_consistent CHECK (
        CASE org_user_state
            WHEN 'disabled' THEN disabled_at IS NOT NULL
            ELSE disabled_at IS NULL AND disabled_by IS NULL
        END
    ),
    CONSTRAINT org_users_email_address_normalized CHECK (
        email_address = lower(btrim(email_address)) AND
        char_length(email_address) BETWEEN 3 AND 254
    ),
    CONSTRAINT org_users_timestamps_ordered CHECK (updated_at >= created_at)
);

-- Which Org terms version an Org accepted, who accepted it, and when. A later
-- version adds a row; accepted rows are never changed.
CREATE TABLE vetchium.org_terms_acceptances (
    org_did uuid NOT NULL REFERENCES vetchium.orgs (org_did)
        ON DELETE CASCADE,
    terms_version text NOT NULL
        CHECK (terms_version ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
    accepted_by uuid NOT NULL REFERENCES vetchium.org_users (org_user_id)
        ON DELETE CASCADE,
    accepted_at timestamptz NOT NULL,
    PRIMARY KEY (org_did, terms_version)
);

-- Credentials live apart from the Org user, so another credential kind such
-- as enterprise single sign-on can be added without reshaping org_users.
CREATE TABLE vetchium.org_user_passwords (
    org_user_id uuid PRIMARY KEY REFERENCES vetchium.org_users (org_user_id)
        ON DELETE CASCADE,
    password_hash text NOT NULL CHECK (length(password_hash) > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_user_passwords_timestamps_ordered CHECK (
        updated_at >= created_at
    )
);

-- A row means TOTP is enabled for the Org user.
CREATE TABLE vetchium.org_user_totp_credentials (
    org_user_id uuid PRIMARY KEY REFERENCES vetchium.org_users (org_user_id)
        ON DELETE CASCADE,
    secret_ciphertext bytea NOT NULL,
    last_timestep bigint,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vetchium.org_permission_catalog (
    permission text PRIMARY KEY CHECK (permission LIKE 'org:%')
);

INSERT INTO vetchium.org_permission_catalog (permission)
VALUES
    ('org:superadmin'),
    ('org:manage_users'),
    ('org:manage_billing'),
    ('org:manage_ai'),
    ('org:view_openings'),
    ('org:manage_openings'),
    ('org:approve_openings'),
    ('org:manage_candidacies'),
    ('org:manage_providers'),
    ('org:manage_listings'),
    ('org:fulfil_engagements');

-- A grant of permission also confers implied_permission, resolved on read by
-- vetchium.org_effective_permissions and never stored as a grant of its own.
CREATE TABLE vetchium.org_permission_implications (
    permission text NOT NULL
        REFERENCES vetchium.org_permission_catalog (permission),
    implied_permission text NOT NULL
        REFERENCES vetchium.org_permission_catalog (permission),
    PRIMARY KEY (permission, implied_permission),
    CONSTRAINT org_permission_implications_not_self CHECK (
        permission <> implied_permission
    )
);

INSERT INTO vetchium.org_permission_implications (permission, implied_permission)
VALUES
    ('org:superadmin', 'org:manage_users'),
    ('org:superadmin', 'org:manage_billing'),
    ('org:superadmin', 'org:manage_ai'),
    ('org:superadmin', 'org:view_openings'),
    ('org:superadmin', 'org:manage_openings'),
    ('org:superadmin', 'org:approve_openings'),
    ('org:superadmin', 'org:manage_candidacies'),
    ('org:superadmin', 'org:manage_providers'),
    ('org:superadmin', 'org:manage_listings'),
    ('org:superadmin', 'org:fulfil_engagements'),
    ('org:manage_openings', 'org:view_openings'),
    ('org:approve_openings', 'org:view_openings');

CREATE TABLE vetchium.org_user_permissions (
    org_user_id uuid NOT NULL REFERENCES vetchium.org_users (org_user_id)
        ON DELETE CASCADE,
    permission text NOT NULL
        REFERENCES vetchium.org_permission_catalog (permission),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_user_id, permission)
);

-- One hop of implication is resolved, as for administrators.
CREATE VIEW vetchium.org_effective_permissions AS
SELECT p.org_user_id, p.permission
FROM vetchium.org_user_permissions AS p
UNION
SELECT p.org_user_id, i.implied_permission
FROM vetchium.org_user_permissions AS p
JOIN vetchium.org_permission_implications AS i
    ON i.permission = p.permission;

-- A pending seat. Exactly one active invitation may exist per address in an
-- Org; an expired one is overwritten by a new invitation.
CREATE TABLE vetchium.org_user_invitations (
    org_invitation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_did uuid NOT NULL REFERENCES vetchium.orgs (org_did)
        ON DELETE CASCADE,
    email_address text NOT NULL CHECK (
        email_address = lower(btrim(email_address)) AND
        char_length(email_address) BETWEEN 3 AND 254
    ),
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    -- An array cannot carry a foreign key, so membership is enforced when the
    -- grants are inserted at acceptance.
    permissions text[] NOT NULL DEFAULT '{}'::text[],
    invited_by uuid NOT NULL REFERENCES vetchium.org_users (org_user_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT org_user_invitations_expiry_check CHECK (
        expires_at > created_at
    ),
    CONSTRAINT org_user_invitations_consumed_inactive CHECK (
        consumed_at IS NULL OR NOT active
    )
);

CREATE UNIQUE INDEX org_user_invitations_active_email_idx
    ON vetchium.org_user_invitations (org_did, email_address) WHERE active;
CREATE INDEX org_user_invitations_expiry_idx
    ON vetchium.org_user_invitations (expires_at);

CREATE TYPE vetchium.org_logo_format AS ENUM ('jpeg', 'png');
CREATE TYPE vetchium.org_logo_state AS ENUM (
    'uploading',
    'active',
    'pending_delete'
);

-- The tenant database owns logo metadata and lifecycle; the tenant's object
-- store owns the bytes. The active row is the Org's logo reference. A row is
-- never active until its bytes are stored, and deletion is authoritative here
-- at once while byte removal is an idempotent, retried outbox task.
CREATE TABLE vetchium.org_logo_objects (
    object_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_did uuid NOT NULL REFERENCES vetchium.orgs (org_did)
        ON DELETE CASCADE,
    format vetchium.org_logo_format NOT NULL,
    byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 2097152),
    width integer NOT NULL CHECK (width BETWEEN 128 AND 4096),
    height integer NOT NULL CHECK (height BETWEEN 128 AND 4096),
    content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
    state vetchium.org_logo_state NOT NULL DEFAULT 'uploading',
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_token uuid,
    leased_until timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    upload_expires_at timestamptz,
    delete_requested_at timestamptz,
    CONSTRAINT org_logo_objects_state_check CHECK (
        (state = 'uploading' AND upload_expires_at IS NOT NULL AND
            delete_requested_at IS NULL) OR
        (state = 'active' AND upload_expires_at IS NULL AND
            delete_requested_at IS NULL) OR
        (state = 'pending_delete' AND upload_expires_at IS NULL AND
            delete_requested_at IS NOT NULL)
    ),
    CONSTRAINT org_logo_objects_lease_check CHECK (
        (lease_token IS NULL) = (leased_until IS NULL)
    )
);

CREATE UNIQUE INDEX org_logo_objects_active_org_idx
    ON vetchium.org_logo_objects (org_did) WHERE state = 'active';
CREATE UNIQUE INDEX org_logo_objects_uploading_org_idx
    ON vetchium.org_logo_objects (org_did) WHERE state = 'uploading';
CREATE INDEX org_logo_objects_deletion_idx
    ON vetchium.org_logo_objects (next_attempt_at)
    WHERE state = 'pending_delete';

-- The single definition of a seat: an active user, or an invitation that has
-- not expired. Disabled users and expired invitations hold none. Callers hold
-- the Org row lock (SELECT ... FOR UPDATE) so the count and the statement that
-- consumes a seat see one serialized history.
CREATE FUNCTION vetchium.org_seats_in_use(p_org_did uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT
        (SELECT count(*) FROM vetchium.org_users AS u
         WHERE u.org_did = p_org_did AND u.org_user_state = 'active') +
        (SELECT count(*) FROM vetchium.org_user_invitations AS i
         WHERE i.org_did = p_org_did AND i.active AND i.consumed_at IS NULL
           AND i.expires_at > now())
$$;

CREATE TABLE vetchium.org_sessions (
    org_session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_user_id uuid NOT NULL REFERENCES vetchium.org_users (org_user_id)
        ON DELETE CASCADE,
    session_token_hash bytea NOT NULL UNIQUE
        CHECK (octet_length(session_token_hash) = 32),
    authenticated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    CONSTRAINT org_sessions_expiry_check CHECK (expires_at > created_at),
    CONSTRAINT org_sessions_authentication_check CHECK (
        authenticated_at >= created_at AND authenticated_at <= expires_at
    )
);

CREATE TABLE vetchium.org_login_challenges (
    org_login_challenge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_user_id uuid NOT NULL REFERENCES vetchium.org_users (org_user_id)
        ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT org_login_challenges_expiry_check CHECK (
        expires_at > created_at
    )
);

CREATE UNIQUE INDEX org_login_challenges_active_user_idx
    ON vetchium.org_login_challenges (org_user_id) WHERE active;

-- A federated sign-in credential. The provider's subject, not the email, is
-- the stable key once linked, so a recycled address cannot inherit a login.
CREATE TABLE vetchium.org_user_sso_identities (
    org_user_id uuid NOT NULL REFERENCES vetchium.org_users (org_user_id)
        ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('google')),
    subject text NOT NULL CHECK (subject <> '' AND char_length(subject) <= 255),
    linked_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_user_id, provider),
    UNIQUE (provider, subject)
);

-- One row per started federated sign-in; consumed once by the callback.
CREATE TABLE vetchium.org_sso_login_states (
    state_hash bytea PRIMARY KEY CHECK (octet_length(state_hash) = 32),
    provider text NOT NULL CHECK (provider IN ('google')),
    domain vetchium.org_domain NOT NULL,
    nonce_hash bytea NOT NULL CHECK (octet_length(nonce_hash) = 32),
    verifier_ciphertext bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    CONSTRAINT org_sso_login_states_expiry_check CHECK (
        expires_at > created_at
    )
);
CREATE INDEX org_sso_login_states_expiry_idx
    ON vetchium.org_sso_login_states (expires_at);

CREATE TABLE vetchium.org_totp_enrollments (
    org_totp_enrollment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_user_id uuid NOT NULL REFERENCES vetchium.org_users (org_user_id)
        ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    secret_ciphertext bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT org_totp_enrollments_expiry_check CHECK (
        expires_at > created_at
    )
);

CREATE UNIQUE INDEX org_totp_enrollments_active_user_idx
    ON vetchium.org_totp_enrollments (org_user_id) WHERE active;

CREATE TABLE vetchium.org_totp_recovery_codes (
    org_user_id uuid NOT NULL REFERENCES vetchium.org_users (org_user_id)
        ON DELETE CASCADE,
    code_hash bytea NOT NULL CHECK (octet_length(code_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    consumed_at timestamptz,
    PRIMARY KEY (org_user_id, code_hash)
);

CREATE TABLE vetchium.org_password_reset_tokens (
    org_password_reset_token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_user_id uuid NOT NULL REFERENCES vetchium.org_users (org_user_id)
        ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT org_password_reset_tokens_expiry_check CHECK (
        expires_at > created_at
    )
);

CREATE UNIQUE INDEX org_password_reset_tokens_active_user_idx
    ON vetchium.org_password_reset_tokens (org_user_id) WHERE active;

-- Public mailbox providers. A listed domain and every subdomain of it can
-- never be claimed by an Org.
CREATE TABLE vetchium.org_signup_blocked_domains (
    domain vetchium.org_domain PRIMARY KEY
);

INSERT INTO vetchium.org_signup_blocked_domains (domain)
VALUES
    ('126.com'),
    ('163.com'),
    ('aol.com'),
    ('fastmail.com'),
    ('gmail.com'),
    ('gmx.com'),
    ('gmx.de'),
    ('gmx.net'),
    ('googlemail.com'),
    ('hey.com'),
    ('hotmail.com'),
    ('icloud.com'),
    ('live.com'),
    ('mac.com'),
    ('mail.com'),
    ('mail.ru'),
    ('me.com'),
    ('msn.com'),
    ('outlook.com'),
    ('pm.me'),
    ('proton.me'),
    ('protonmail.com'),
    ('qq.com'),
    ('rediffmail.com'),
    ('tuta.io'),
    ('tutanota.com'),
    ('web.de'),
    ('yahoo.com'),
    ('yandex.com'),
    ('yandex.ru'),
    ('ymail.com'),
    ('zoho.com');

-- The email domain must be exactly the claimed domain. verification_token is
-- the public DNS value; the signup link token is stored only as its hash.
CREATE TABLE vetchium.org_signup_requests (
    org_signup_request_id uuid PRIMARY KEY,
    email_address text NOT NULL,
    domain vetchium.org_domain NOT NULL,
    preferred_language vetchium.org_frontend_locale NOT NULL,
    verification_token text NOT NULL
        CHECK (verification_token ~ '^[a-z2-7]{26}$'),
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    active boolean NOT NULL DEFAULT true,
    CONSTRAINT org_signup_requests_email_check CHECK (
        email_address = lower(btrim(email_address)) AND
        char_length(email_address) BETWEEN 3 AND 254 AND
        split_part(email_address, '@', 2) = domain
    ),
    CONSTRAINT org_signup_requests_expiry_check CHECK (
        expires_at > created_at
    )
);

CREATE UNIQUE INDEX org_signup_requests_active_email_idx
    ON vetchium.org_signup_requests (email_address) WHERE active;

CREATE TYPE vetchium.org_signup_completion_state AS ENUM (
    'prepared',
    'reserved',
    'local_created',
    'completed',
    'failed'
);

-- The origin-side durable operation for the global Org signup saga. The
-- encrypted payload holds what finishing the local Org needs after a restart;
-- command IDs never change once sent.
CREATE TABLE vetchium.org_signup_completions (
    operation_id uuid PRIMARY KEY,
    org_signup_request_id uuid NOT NULL UNIQUE,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    idempotency_key text NOT NULL,
    request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
    org_did uuid NOT NULL UNIQUE,
    domain vetchium.org_domain NOT NULL,
    reserve_command_id uuid NOT NULL UNIQUE,
    activate_command_id uuid NOT NULL UNIQUE,
    payload_ciphertext bytea NOT NULL,
    state vetchium.org_signup_completion_state NOT NULL DEFAULT 'prepared',
    failure_reason text CHECK (
        failure_reason IN ('domain_owned', 'reservation_expired')
    ),
    provisioning_expires_at timestamptz NOT NULL,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    expires_at timestamptz NOT NULL,
    CONSTRAINT org_signup_completions_did_uuidv7_check CHECK (
        substring(org_did::text FROM 15 FOR 1) = '7'
    ),
    CONSTRAINT org_signup_completions_failure_check CHECK (
        (state = 'failed') = (failure_reason IS NOT NULL)
    ),
    CONSTRAINT org_signup_completions_times_check CHECK (
        updated_at >= created_at
        AND provisioning_expires_at > created_at
        AND expires_at > provisioning_expires_at
        AND ((state IN ('completed', 'failed')) = (completed_at IS NOT NULL))
    )
);

CREATE INDEX org_signup_completions_recovery_idx
    ON vetchium.org_signup_completions (next_attempt_at, created_at)
    WHERE state NOT IN ('completed', 'failed');

CREATE TABLE vetchium.org_email_outbox (
    org_email_outbox_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind text NOT NULL CHECK (kind IN (
        'signup-dns-instructions',
        'signup-link',
        'password-reset',
        'domain-failing',
        'org-suspended',
        'invitation'
    )),
    recipient_email_address text NOT NULL,
    preferred_language vetchium.org_frontend_locale NOT NULL,
    payload_ciphertext bytea NOT NULL,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_token uuid,
    leased_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    failed_at timestamptz,
    CONSTRAINT org_email_outbox_lease_consistent CHECK (
        (lease_token IS NULL) = (leased_until IS NULL)
    ),
    CONSTRAINT org_email_outbox_result_consistent CHECK (
        NOT (sent_at IS NOT NULL AND failed_at IS NOT NULL)
    )
);

CREATE TYPE vetchium.org_opening_state AS ENUM (
    'draft', 'discarded', 'published', 'paused', 'closed', 'expired'
);
CREATE TYPE vetchium.org_opening_work_arrangement AS ENUM (
    'on_site', 'hybrid', 'remote'
);
CREATE TYPE vetchium.org_opening_remote_eligibility AS ENUM (
    'worldwide', 'countries'
);
CREATE TYPE vetchium.org_opening_employment_type AS ENUM (
    'full_time', 'part_time', 'contract', 'internship'
);
CREATE TYPE vetchium.org_opening_education AS ENUM (
    'secondary', 'bachelor', 'master', 'doctorate'
);
CREATE TYPE vetchium.org_opening_salary_period AS ENUM (
    'hour', 'day', 'month', 'year'
);
CREATE TYPE vetchium.org_opening_content_slot AS ENUM ('live', 'working');
CREATE TYPE vetchium.org_opening_request_kind AS ENUM (
    'publish', 'revise', 'pause', 'reopen', 'close'
);
CREATE TYPE vetchium.org_opening_request_state AS ENUM (
    'pending', 'approved', 'rejected', 'withdrawn', 'superseded', 'cancelled'
);
CREATE TYPE vetchium.org_opening_history_action AS ENUM (
    'created', 'duplicated', 'working_copy_saved', 'team_changed',
    'pipeline_changed', 'revision_discarded',
    'discarded', 'requested', 'approved', 'self_approved', 'rejected',
    'withdrawn', 'superseded', 'cancelled', 'expired'
);

CREATE TABLE vetchium.org_openings (
    org_opening_id uuid PRIMARY KEY,
    org_did uuid NOT NULL REFERENCES vetchium.orgs (org_did)
        ON DELETE CASCADE,
    opening_number integer NOT NULL CHECK (opening_number >= 1),
    opening_state vetchium.org_opening_state NOT NULL DEFAULT 'draft',
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
    -- The next application number; hub-apply allocates it under the row lock.
    next_application_number integer NOT NULL DEFAULT 1
        CHECK (next_application_number >= 1),
    hiring_manager_id uuid REFERENCES vetchium.org_users (org_user_id)
        ON DELETE SET NULL,
    recruiter_id uuid REFERENCES vetchium.org_users (org_user_id)
        ON DELETE SET NULL,
    internal_notes text,
    created_by uuid NOT NULL REFERENCES vetchium.org_users (org_user_id)
        ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    first_published_at timestamptz,
    expires_at timestamptz,
    last_revised_at timestamptz,
    ended_at timestamptz,
    CONSTRAINT org_openings_org_number_key UNIQUE (org_did, opening_number),
    CONSTRAINT org_openings_notes_check CHECK (
        internal_notes IS NULL OR (
            internal_notes = btrim(internal_notes)
            AND char_length(internal_notes) BETWEEN 1 AND 2000
        )
    ),
    CONSTRAINT org_openings_published_at_check CHECK (
        (first_published_at IS NULL)
        = (opening_state IN ('draft', 'discarded'))
    ),
    CONSTRAINT org_openings_expiry_check CHECK (
        (first_published_at IS NULL AND expires_at IS NULL)
        OR (first_published_at IS NOT NULL AND expires_at IS NOT NULL
            AND expires_at = first_published_at + interval '180 days')
    ),
    CONSTRAINT org_openings_ended_at_check CHECK (
        (ended_at IS NOT NULL)
        = (opening_state IN ('discarded', 'closed', 'expired'))
    ),
    CONSTRAINT org_openings_discarded_empty_check CHECK (
        opening_state <> 'discarded'
        OR (hiring_manager_id IS NULL AND recruiter_id IS NULL
            AND internal_notes IS NULL)
    ),
    CONSTRAINT org_openings_last_revised_check CHECK (
        (last_revised_at IS NULL) = (revision = 0)
    ),
    CONSTRAINT org_openings_timestamps_check CHECK (
        updated_at >= created_at
        AND (first_published_at IS NULL OR first_published_at >= created_at)
    )
);

CREATE INDEX org_openings_quota_idx
    ON vetchium.org_openings (org_did, created_at);
CREATE INDEX org_openings_expiry_idx
    ON vetchium.org_openings (expires_at)
    WHERE opening_state IN ('published', 'paused');
CREATE INDEX org_openings_list_idx
    ON vetchium.org_openings (org_did, updated_at DESC, opening_number DESC);
CREATE INDEX org_openings_hiring_manager_idx
    ON vetchium.org_openings (hiring_manager_id);
CREATE INDEX org_openings_recruiter_idx
    ON vetchium.org_openings (recruiter_id);

-- Keep these constraints in step with common.OpeningContent.Validate. A draft
-- may be incomplete; only the live slot must be complete.
CREATE TABLE vetchium.org_opening_contents (
    org_opening_id uuid NOT NULL REFERENCES vetchium.org_openings
        (org_opening_id) ON DELETE CASCADE,
    slot vetchium.org_opening_content_slot NOT NULL,
    title text,
    description text,
    language text,
    employing_country text,
    work_arrangement vetchium.org_opening_work_arrangement,
    location_details text,
    remote_eligibility vetchium.org_opening_remote_eligibility,
    remote_countries text[],
    employment_type vetchium.org_opening_employment_type,
    positions integer,
    experience_min integer,
    experience_max integer,
    minimum_education vetchium.org_opening_education,
    salary_currency text,
    salary_min bigint,
    salary_max bigint,
    salary_period vetchium.org_opening_salary_period,
    -- Application questions (HP-QST-001) as the contract's question list;
    -- NULL means none. orgs-api validates each question.
    questions jsonb,
    updated_by uuid NOT NULL REFERENCES vetchium.org_users (org_user_id)
        ON DELETE CASCADE,
    updated_at timestamptz NOT NULL DEFAULT now(),
    complete boolean GENERATED ALWAYS AS (
        title IS NOT NULL AND description IS NOT NULL
        AND language IS NOT NULL AND employing_country IS NOT NULL
        AND work_arrangement IS NOT NULL AND employment_type IS NOT NULL
        AND positions IS NOT NULL
        AND (work_arrangement <> 'remote' OR remote_eligibility IS NOT NULL)
    ) STORED,
    PRIMARY KEY (org_opening_id, slot),
    CONSTRAINT org_opening_contents_title_check CHECK (
        title IS NULL OR (title = btrim(title)
            AND char_length(title) BETWEEN 1 AND 200)
    ),
    CONSTRAINT org_opening_contents_description_check CHECK (
        description IS NULL OR (description = btrim(description)
            AND char_length(description) BETWEEN 1 AND 20000)
    ),
    CONSTRAINT org_opening_contents_language_check CHECK (
        language IS NULL OR language ~ '^[a-z]{2,3}$'
    ),
    CONSTRAINT org_opening_contents_country_check CHECK (
        employing_country IS NULL
        OR employing_country ~ '^[A-Z]{2}$'
    ),
    CONSTRAINT org_opening_contents_location_check CHECK (
        location_details IS NULL OR (location_details = btrim(location_details)
            AND char_length(location_details) <= 2000)
    ),
    CONSTRAINT org_opening_contents_remote_check CHECK (
        (remote_eligibility IS NULL AND remote_countries IS NULL)
        OR (remote_eligibility IS NOT NULL
            AND work_arrangement = 'remote' AND (
            (remote_eligibility = 'worldwide' AND remote_countries IS NULL)
            OR (remote_eligibility = 'countries'
                AND remote_countries IS NOT NULL
                AND cardinality(remote_countries) > 0
                AND array_position(remote_countries, NULL) IS NULL
                AND vetchium.array_is_distinct(remote_countries)
                AND array_to_string(remote_countries, ',')
                    ~ '^([A-Z]{2})(,[A-Z]{2})*$'
                AND (employing_country IS NULL
                    OR employing_country = ANY(remote_countries)))
        ))
    ),
    CONSTRAINT org_opening_contents_remote_arrangement_check CHECK (
        remote_eligibility IS NULL OR (
            work_arrangement IS NOT NULL AND work_arrangement = 'remote')
    ),
    CONSTRAINT org_opening_contents_positions_check CHECK (
        positions IS NULL OR positions BETWEEN 1 AND 10
    ),
    CONSTRAINT org_opening_contents_experience_check CHECK (
        (experience_min IS NULL OR experience_min BETWEEN 0 AND 50)
        AND (experience_max IS NULL OR experience_max BETWEEN 0 AND 50)
        AND (experience_min IS NULL OR experience_max IS NULL
            OR experience_min <= experience_max)
    ),
    CONSTRAINT org_opening_contents_salary_check CHECK (
        (salary_currency IS NULL AND salary_min IS NULL
            AND salary_max IS NULL AND salary_period IS NULL)
        OR (salary_currency IS NOT NULL AND salary_min IS NOT NULL
            AND salary_max IS NOT NULL AND salary_period IS NOT NULL
            AND salary_currency ~ '^[A-Z]{3}$'
            AND salary_min >= 0 AND salary_min <= salary_max
            AND salary_max BETWEEN 1 AND 1000000000000)
    ),
    CONSTRAINT org_opening_contents_questions_check CHECK (
        questions IS NULL OR (jsonb_typeof(questions) = 'array'
            AND jsonb_array_length(questions) BETWEEN 1 AND 10)
    ),
    CONSTRAINT org_opening_contents_live_complete_check CHECK (
        slot <> 'live' OR complete
    )
);

CREATE TABLE vetchium.org_opening_team_members (
    org_opening_id uuid NOT NULL REFERENCES vetchium.org_openings
        (org_opening_id) ON DELETE CASCADE,
    org_user_id uuid NOT NULL REFERENCES vetchium.org_users (org_user_id)
        ON DELETE CASCADE,
    PRIMARY KEY (org_opening_id, org_user_id)
);
CREATE INDEX org_opening_team_members_user_idx
    ON vetchium.org_opening_team_members (org_user_id);

CREATE TABLE vetchium.org_opening_requests (
    org_opening_request_id uuid PRIMARY KEY,
    org_opening_id uuid NOT NULL REFERENCES vetchium.org_openings
        (org_opening_id) ON DELETE CASCADE,
    request_kind vetchium.org_opening_request_kind NOT NULL,
    request_state vetchium.org_opening_request_state NOT NULL DEFAULT 'pending',
    requested_by uuid NOT NULL REFERENCES vetchium.org_users (org_user_id)
        ON DELETE CASCADE,
    requested_at timestamptz NOT NULL DEFAULT now(),
    request_note text,
    decided_by uuid REFERENCES vetchium.org_users (org_user_id)
        ON DELETE CASCADE,
    decided_at timestamptz,
    decision_note text,
    self_approved boolean NOT NULL DEFAULT false,
    -- A close request's choice to mark every non-terminal application
    -- not_progressing when the close applies (HP-APP-005).
    mark_applications_not_progressing boolean NOT NULL DEFAULT false,
    CONSTRAINT org_opening_requests_close_check CHECK (
        NOT mark_applications_not_progressing OR request_kind = 'close'
    ),
    CONSTRAINT org_opening_requests_pending_check CHECK (
        (request_state = 'pending') = (decided_at IS NULL)
    ),
    CONSTRAINT org_opening_requests_rejected_note_check CHECK (
        request_state <> 'rejected' OR decision_note IS NOT NULL
    ),
    CONSTRAINT org_opening_requests_decider_check CHECK (
        (request_state IN ('approved', 'rejected', 'withdrawn'))
        = (decided_by IS NOT NULL)
    ),
    CONSTRAINT org_opening_requests_self_approved_check CHECK (
        NOT self_approved OR request_state = 'approved'
    ),
    CONSTRAINT org_opening_requests_notes_check CHECK (
        (request_note IS NULL OR (request_note = btrim(request_note)
            AND char_length(request_note) BETWEEN 1 AND 2000))
        AND (decision_note IS NULL OR (decision_note = btrim(decision_note)
            AND char_length(decision_note) BETWEEN 1 AND 2000))
    )
);
CREATE UNIQUE INDEX org_opening_requests_one_pending_idx
    ON vetchium.org_opening_requests (org_opening_id)
    WHERE request_state = 'pending';

CREATE TABLE vetchium.org_opening_history (
    org_opening_history_id uuid PRIMARY KEY,
    org_opening_id uuid NOT NULL REFERENCES vetchium.org_openings
        (org_opening_id) ON DELETE CASCADE,
    action vetchium.org_opening_history_action NOT NULL,
    actor_org_user_id uuid REFERENCES vetchium.org_users (org_user_id)
        ON DELETE SET NULL,
    org_opening_request_id uuid REFERENCES vetchium.org_opening_requests
        (org_opening_request_id) ON DELETE CASCADE,
    request_kind vetchium.org_opening_request_kind,
    request_state vetchium.org_opening_request_state,
    opening_version integer NOT NULL CHECK (opening_version >= 1),
    source_opening_number integer CHECK (source_opening_number >= 1),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX org_opening_history_list_idx
    ON vetchium.org_opening_history
    (org_opening_id, created_at DESC, org_opening_history_id DESC);

-- Marketplace Listings (agent-guides/marketplace.md): one per (provider Org,
-- Capability). Only `listed` appears in search. There is no amount or fee
-- column anywhere (MKT-GEN-001); the indicative price is free text. Element
-- uniqueness and vocabularies of the arrays are the contract's to validate.
CREATE TYPE vetchium.org_listing_state AS ENUM (
    'draft',
    'listed',
    'unlisted'
);

CREATE TABLE vetchium.org_listings (
    org_listing_id uuid PRIMARY KEY,
    org_did uuid NOT NULL REFERENCES vetchium.orgs (org_did)
        ON DELETE CASCADE,
    capability_oid text NOT NULL
        REFERENCES vetchium.capabilities (capability_oid),
    listing_state vetchium.org_listing_state NOT NULL DEFAULT 'draft',
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    headline text NOT NULL,
    description text NOT NULL,
    service_worldwide boolean NOT NULL,
    service_countries text[] NOT NULL,
    languages text[] NOT NULL,
    indicative_price text,
    -- Both belong to `background_check` Listings alone.
    check_types text[] NOT NULL,
    consent_disclosure text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_listings_headline_check CHECK (
        headline = btrim(headline) AND char_length(headline) BETWEEN 1 AND 200
    ),
    CONSTRAINT org_listings_description_check CHECK (
        description = btrim(description)
        AND char_length(description) BETWEEN 1 AND 10000
    ),
    CONSTRAINT org_listings_service_check CHECK (
        (service_worldwide AND cardinality(service_countries) = 0)
        OR (NOT service_worldwide
            AND cardinality(service_countries) BETWEEN 1 AND 250)
    ),
    CONSTRAINT org_listings_languages_check CHECK (
        cardinality(languages) <= 20
    ),
    CONSTRAINT org_listings_price_check CHECK (
        indicative_price IS NULL OR (
            indicative_price = btrim(indicative_price)
            AND char_length(indicative_price) BETWEEN 1 AND 500
        )
    ),
    CONSTRAINT org_listings_background_check CHECK (
        CASE WHEN capability_oid = 'background_check' THEN
            cardinality(check_types) BETWEEN 1 AND 20
            AND consent_disclosure IS NOT NULL
            AND consent_disclosure = btrim(consent_disclosure)
            AND char_length(consent_disclosure) BETWEEN 1 AND 5000
        ELSE
            cardinality(check_types) = 0 AND consent_disclosure IS NULL
        END
    ),
    CONSTRAINT org_listings_timestamps_check CHECK (updated_at >= created_at)
);
CREATE UNIQUE INDEX org_listings_capability_key
    ON vetchium.org_listings (org_did, capability_oid);
CREATE INDEX org_listings_search_idx
    ON vetchium.org_listings (capability_oid, org_did)
    WHERE listing_state = 'listed';

-- Marketplace engagements (agent-guides/marketplace.md). The consumer's
-- tenant is authoritative; the provider's tenant keeps only the projection
-- below, fed by the consumer's outbox (MKT-GEN-004). The provider is a DID
-- and a recorded name, never a reference, because it may live in another
-- tenant.
CREATE TYPE vetchium.org_engagement_state AS ENUM (
    'proposed',
    'active',
    'declined',
    'withdrawn',
    'expired',
    'ended'
);

CREATE TYPE vetchium.org_engagement_party AS ENUM ('consumer', 'provider');

CREATE TABLE vetchium.org_engagements (
    engagement_id uuid PRIMARY KEY,
    consumer_org_did uuid NOT NULL REFERENCES vetchium.orgs (org_did)
        ON DELETE CASCADE,
    provider_org_did uuid NOT NULL,
    provider_domain text NOT NULL,
    provider_display_name text NOT NULL,
    capability_oid text NOT NULL
        REFERENCES vetchium.capabilities (capability_oid),
    engagement_state vetchium.org_engagement_state NOT NULL DEFAULT 'proposed',
    -- Proposals awaiting a decision list first, then active, then the rest.
    state_rank smallint GENERATED ALWAYS AS (
        CASE engagement_state
            WHEN 'proposed' THEN 0 WHEN 'active' THEN 1 ELSE 2
        END
    ) STORED,
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    message text,
    consumer_reference text,
    provider_reference text,
    end_note text,
    ended_by vetchium.org_engagement_party,
    proposed_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    decided_at timestamptz,
    ended_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_engagements_not_self CHECK (
        consumer_org_did <> provider_org_did
    ),
    CONSTRAINT org_engagements_names_check CHECK (
        provider_domain = btrim(provider_domain)
        AND char_length(provider_domain) BETWEEN 3 AND 253
        AND provider_display_name = btrim(provider_display_name)
        AND char_length(provider_display_name) BETWEEN 1 AND 200
    ),
    CONSTRAINT org_engagements_text_check CHECK (
        (message IS NULL OR (message = btrim(message)
            AND char_length(message) BETWEEN 1 AND 2000))
        AND (consumer_reference IS NULL OR (
            consumer_reference = btrim(consumer_reference)
            AND char_length(consumer_reference) BETWEEN 1 AND 200))
        AND (provider_reference IS NULL OR (
            provider_reference = btrim(provider_reference)
            AND char_length(provider_reference) BETWEEN 1 AND 200))
        AND (end_note IS NULL OR (end_note = btrim(end_note)
            AND char_length(end_note) BETWEEN 1 AND 2000))
    ),
    CONSTRAINT org_engagements_end_check CHECK (
        CASE WHEN engagement_state = 'ended' THEN
            ended_by IS NOT NULL AND ended_at IS NOT NULL
        ELSE
            ended_by IS NULL AND ended_at IS NULL AND end_note IS NULL
        END
    ),
    CONSTRAINT org_engagements_times_check CHECK (
        expires_at > proposed_at AND updated_at >= created_at
    )
);
CREATE UNIQUE INDEX org_engagements_live_key
    ON vetchium.org_engagements
    (consumer_org_did, provider_org_did, capability_oid)
    WHERE engagement_state IN ('proposed', 'active');
CREATE INDEX org_engagements_list_idx
    ON vetchium.org_engagements
    (consumer_org_did, state_rank, proposed_at DESC, engagement_id DESC);
CREATE INDEX org_engagements_expiry_idx
    ON vetchium.org_engagements (expires_at)
    WHERE engagement_state = 'proposed';

-- The consumer's engagements with the consumer Org's domain and name, under
-- the column names of the provider-side projection, so both sides read and
-- map one shape.
CREATE VIEW vetchium.org_engagement_snapshots AS
SELECT e.engagement_id, e.version, e.consumer_org_did,
    d.domain::text AS consumer_domain,
    o.display_name AS consumer_display_name,
    e.provider_org_did, e.provider_domain, e.provider_display_name,
    e.capability_oid, e.engagement_state, e.state_rank, e.message,
    e.consumer_reference, e.provider_reference, e.end_note, e.ended_by,
    e.proposed_at, e.expires_at, e.decided_at, e.ended_at, e.updated_at
FROM vetchium.org_engagements AS e
JOIN vetchium.orgs AS o ON o.org_did = e.consumer_org_did
JOIN vetchium.org_domains AS d ON d.org_did = e.consumer_org_did;

CREATE TABLE vetchium.org_engagement_projections (
    engagement_id uuid PRIMARY KEY,
    provider_org_did uuid NOT NULL REFERENCES vetchium.orgs (org_did)
        ON DELETE CASCADE,
    version integer NOT NULL CHECK (version >= 1),
    consumer_org_did uuid NOT NULL,
    consumer_domain text NOT NULL,
    consumer_display_name text NOT NULL,
    provider_domain text NOT NULL,
    provider_display_name text NOT NULL,
    -- No reference to the Capability table: the consumer's tenant may know a
    -- Capability this tenant does not yet, and a projection must not refuse it.
    capability_oid text NOT NULL
        CHECK (capability_oid ~ '^[a-z]+(_[a-z]+)*$'),
    engagement_state vetchium.org_engagement_state NOT NULL,
    state_rank smallint GENERATED ALWAYS AS (
        CASE engagement_state
            WHEN 'proposed' THEN 0 WHEN 'active' THEN 1 ELSE 2
        END
    ) STORED,
    message text,
    consumer_reference text,
    provider_reference text,
    end_note text,
    ended_by vetchium.org_engagement_party,
    proposed_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    decided_at timestamptz,
    ended_at timestamptz,
    updated_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_engagement_projections_not_self CHECK (
        consumer_org_did <> provider_org_did
    )
);
CREATE INDEX org_engagement_projections_list_idx
    ON vetchium.org_engagement_projections
    (provider_org_did, state_rank, proposed_at DESC, engagement_id DESC);

-- The agency user who looks after a Job (an Opening assigned to a `sourcing`
-- engagement), agency-private and kept in the agency's tenant
-- (agent-guides/marketplace.md, MKT-OWN). Clearing keeps the row with a NULL
-- owner so the version keeps rising. The Opening itself stays in the client's
-- tenant; a row whose Opening was unassigned or whose engagement ended is
-- inert, because every Jobs list reads live from the client's tenant.
CREATE TABLE vetchium.org_job_owners (
    engagement_id uuid NOT NULL
        REFERENCES vetchium.org_engagement_projections (engagement_id)
        ON DELETE CASCADE,
    opening_number integer NOT NULL CHECK (opening_number >= 1),
    org_did uuid NOT NULL REFERENCES vetchium.orgs (org_did)
        ON DELETE CASCADE,
    owner_org_user_id uuid REFERENCES vetchium.org_users (org_user_id)
        ON DELETE SET NULL,
    version integer NOT NULL CHECK (version >= 1),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (engagement_id, opening_number)
);
CREATE INDEX org_job_owners_owner_idx
    ON vetchium.org_job_owners (owner_org_user_id)
    WHERE owner_org_user_id IS NOT NULL;

-- Hiring pipelines (agent-guides/hiring-pipeline.md). A template is a named
-- stage list an Org copies into new Openings; editing one never changes an
-- Opening. Stage positions are written 1..n from the submitted order.
CREATE TABLE vetchium.org_pipeline_templates (
    org_pipeline_template_id uuid PRIMARY KEY,
    org_did uuid NOT NULL REFERENCES vetchium.orgs (org_did)
        ON DELETE CASCADE,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_pipeline_templates_name_check CHECK (
        name = btrim(name) AND char_length(name) BETWEEN 1 AND 100
    ),
    CONSTRAINT org_pipeline_templates_timestamps_check CHECK (
        updated_at >= created_at
    )
);
CREATE UNIQUE INDEX org_pipeline_templates_name_key
    ON vetchium.org_pipeline_templates (org_did, lower(name));
CREATE INDEX org_pipeline_templates_list_idx
    ON vetchium.org_pipeline_templates
    (org_did, lower(name), org_pipeline_template_id);

CREATE TABLE vetchium.org_pipeline_template_stages (
    org_pipeline_template_id uuid NOT NULL
        REFERENCES vetchium.org_pipeline_templates
        (org_pipeline_template_id) ON DELETE CASCADE,
    position smallint NOT NULL CHECK (position BETWEEN 1 AND 15),
    name text NOT NULL,
    stage_kind vetchium.pipeline_stage_kind NOT NULL,
    -- FeedbackCriterion[] (HP-FRM-001).
    feedback_form jsonb NOT NULL DEFAULT '[]',
    PRIMARY KEY (org_pipeline_template_id, position),
    CONSTRAINT org_pipeline_template_stages_name_check CHECK (
        name = btrim(name) AND char_length(name) BETWEEN 1 AND 100
    ),
    CONSTRAINT org_pipeline_template_stages_feedback_form_check CHECK (
        jsonb_typeof(feedback_form) = 'array'
        AND jsonb_array_length(feedback_form) <= 10
        AND (stage_kind = 'interview'
            OR jsonb_array_length(feedback_form) = 0)
    )
);

-- An Opening owns its pipeline. The unique position is deferred so one
-- statement can reorder stages.
CREATE TABLE vetchium.org_opening_stages (
    org_opening_stage_id uuid PRIMARY KEY,
    org_opening_id uuid NOT NULL REFERENCES vetchium.org_openings
        (org_opening_id) ON DELETE CASCADE,
    position smallint NOT NULL CHECK (position BETWEEN 1 AND 15),
    name text NOT NULL,
    stage_kind vetchium.pipeline_stage_kind NOT NULL,
    -- FeedbackCriterion[] (HP-FRM-001); feedback keeps its own snapshot.
    feedback_form jsonb NOT NULL DEFAULT '[]',
    CONSTRAINT org_opening_stages_position_key
        UNIQUE (org_opening_id, position) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT org_opening_stages_opening_key
        UNIQUE (org_opening_stage_id, org_opening_id),
    CONSTRAINT org_opening_stages_name_check CHECK (
        name = btrim(name) AND char_length(name) BETWEEN 1 AND 100
    ),
    CONSTRAINT org_opening_stages_feedback_form_check CHECK (
        jsonb_typeof(feedback_form) = 'array'
        AND jsonb_array_length(feedback_form) <= 10
        AND (stage_kind = 'interview'
            OR jsonb_array_length(feedback_form) = 0)
    )
);

-- Applications (agent-guides/hiring-pipeline.md). They belong to the Opening's
-- Org and are written only by the hub-apply command and the Org's own
-- transitions. An applicant is one row per (Org, person); every other row
-- references the applicant id, never the Hub user DID, which has no foreign
-- key because the Hub user may live in another tenant.
CREATE TYPE vetchium.org_applicant_kind AS ENUM ('hub_user');
CREATE TYPE vetchium.org_application_state AS ENUM (
    'submitted', 'in_pipeline', 'offered', 'offer_accepted', 'offer_declined',
    'joined', 'did_not_join', 'not_progressing', 'withdrawn'
);
CREATE TYPE vetchium.org_application_stage_status AS ENUM (
    'pending', 'completed', 'skipped'
);
CREATE TYPE vetchium.org_application_history_action AS ENUM (
    'applied', 'shortlisted', 'stage_moved', 'offer_extended',
    'offer_withdrawn', 'offer_accepted', 'offer_declined', 'joined',
    'did_not_join', 'not_progressing', 'withdrawn', 'stage_completed',
    'separated', 'joined_corrected', 'separated_corrected',
    'interview_scheduled', 'interview_changed', 'interview_cancelled',
    'interview_completed', 'interview_no_show', 'interview_accepted',
    'interview_reschedule_requested', 'interview_feedback_submitted',
    'assessment_recorded', 'background_check_consent_requested',
    'background_check_consent_given', 'background_check_consent_declined',
    'background_check_result_recorded', 'routed', 'removed'
);
CREATE TYPE vetchium.org_application_actor_kind AS ENUM (
    'applicant', 'org_user', 'provider', 'system'
);

CREATE TABLE vetchium.org_applicants (
    org_applicant_id uuid PRIMARY KEY,
    org_did uuid NOT NULL REFERENCES vetchium.orgs (org_did)
        ON DELETE CASCADE,
    applicant_kind vetchium.org_applicant_kind NOT NULL,
    hub_user_did uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_applicants_kind_check CHECK (
        applicant_kind <> 'hub_user' OR hub_user_did IS NOT NULL
    ),
    CONSTRAINT org_applicants_hub_user_key UNIQUE (org_did, hub_user_did)
);

-- A candidacy (in_pipeline, offered, offer_accepted) is always at a stage;
-- removing a stage that holds one is refused by the pipeline statement, and
-- ON DELETE SET NULL turns a concurrent race into a failed check instead of
-- a candidate without a stage.
CREATE TABLE vetchium.org_applications (
    org_application_id uuid PRIMARY KEY,
    org_opening_id uuid NOT NULL REFERENCES vetchium.org_openings
        (org_opening_id) ON DELETE CASCADE,
    application_number integer NOT NULL CHECK (application_number >= 1),
    org_applicant_id uuid NOT NULL REFERENCES vetchium.org_applicants
        (org_applicant_id) ON DELETE CASCADE,
    application_state vetchium.org_application_state NOT NULL
        DEFAULT 'submitted',
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    snapshot jsonb NOT NULL,
    cover_note text,
    -- The live questions at apply time, each with its answer (HP-QST-005);
    -- written once. Retention empties it.
    answers jsonb NOT NULL DEFAULT '[]',
    current_stage_id uuid REFERENCES vetchium.org_opening_stages
        (org_opening_stage_id) ON DELETE SET NULL,
    -- When the offer that led to offer_accepted was extended; the offer
    -- extension writes it, and joined_on may not precede it (HP-STA-005).
    offer_extended_at timestamptz,
    -- Facts the Org records. Each *_recorded_at is the first recording, which
    -- opens the 90-day correction window; history keeps every value.
    joined_on date,
    joined_recorded_at timestamptz,
    separated_on date,
    separated_recorded_at timestamptz,
    -- Retention (HP-RET-001) replaces the snapshot with the display name
    -- "Removed applicant" and clears everything personal; the numbers,
    -- states, dates, and history stay.
    removed_at timestamptz,
    -- When the next unanswered interview starts: the instant the Hub
    -- projection's interview_response action stops being true (HP-HUB-007).
    -- Every projection event rewrites it; the refresh job re-reports the
    -- application once it passes.
    hub_refresh_at timestamptz,
    -- One sourcing engagement may be credited with the application (MKT-SRC-001).
    credited_engagement_id uuid REFERENCES vetchium.org_engagements
        (engagement_id) ON DELETE SET NULL,
    referral_route text CHECK (referral_route IS NULL OR referral_route IN ('suggested', 'declared')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_applications_number_key
        UNIQUE (org_opening_id, application_number),
    CONSTRAINT org_applications_applicant_key
        UNIQUE (org_opening_id, org_applicant_id),
    CONSTRAINT org_applications_referral_check CHECK (
        (credited_engagement_id IS NULL) = (referral_route IS NULL)
    ),
    CONSTRAINT org_applications_snapshot_check CHECK (
        jsonb_typeof(snapshot) = 'object'
        AND jsonb_typeof(snapshot -> 'display_name') = 'string'
    ),
    CONSTRAINT org_applications_cover_note_check CHECK (
        cover_note IS NULL OR (
            cover_note = btrim(cover_note)
            AND char_length(cover_note) BETWEEN 1 AND 5000
        )
    ),
    CONSTRAINT org_applications_answers_check CHECK (
        jsonb_typeof(answers) = 'array' AND jsonb_array_length(answers) <= 10
    ),
    CONSTRAINT org_applications_stage_check CHECK (
        application_state <> 'submitted' OR current_stage_id IS NULL
    ),
    CONSTRAINT org_applications_candidacy_stage_check CHECK (
        application_state NOT IN ('in_pipeline', 'offered', 'offer_accepted')
        OR current_stage_id IS NOT NULL
    ),
    CONSTRAINT org_applications_timestamps_check CHECK (
        updated_at >= created_at
    ),
    CONSTRAINT org_applications_joined_check CHECK (
        (application_state = 'joined') = (joined_on IS NOT NULL)
        AND (joined_on IS NULL) = (joined_recorded_at IS NULL)
    ),
    CONSTRAINT org_applications_separated_check CHECK (
        (separated_on IS NULL) = (separated_recorded_at IS NULL)
        AND (separated_on IS NULL OR (
            joined_on IS NOT NULL AND separated_on > joined_on
            AND separated_on <= joined_on + 365
        ))
    )
);
CREATE INDEX org_applications_stage_idx
    ON vetchium.org_applications (current_stage_id)
    WHERE current_stage_id IS NOT NULL;
CREATE INDEX org_applications_credited_engagement_idx
    ON vetchium.org_applications (credited_engagement_id)
    WHERE credited_engagement_id IS NOT NULL;
CREATE INDEX org_applications_hub_refresh_idx
    ON vetchium.org_applications (hub_refresh_at)
    WHERE hub_refresh_at IS NOT NULL;
CREATE INDEX org_applications_retention_idx
    ON vetchium.org_applications (updated_at)
    WHERE removed_at IS NULL AND application_state IN
        ('offer_declined', 'did_not_join', 'not_progressing', 'withdrawn');
CREATE INDEX org_applications_joined_retention_idx
    ON vetchium.org_applications (joined_on)
    WHERE removed_at IS NULL AND application_state = 'joined';

-- One row per stage of the Opening's pipeline for a candidacy, written when
-- the applicant is shortlisted. Deleting a stage deletes its records.
CREATE TABLE vetchium.org_application_stages (
    org_application_id uuid NOT NULL REFERENCES vetchium.org_applications
        (org_application_id) ON DELETE CASCADE,
    org_opening_stage_id uuid NOT NULL REFERENCES vetchium.org_opening_stages
        (org_opening_stage_id) ON DELETE CASCADE,
    stage_status vetchium.org_application_stage_status NOT NULL
        DEFAULT 'pending',
    PRIMARY KEY (org_application_id, org_opening_stage_id)
);
CREATE INDEX org_application_stages_stage_idx
    ON vetchium.org_application_stages (org_opening_stage_id);

-- What a consumer attached to an Opening (agent-guides/marketplace.md,
-- MKT-ASG): an active `sourcing` engagement to the whole Opening, or an
-- engagement of the Capability that performs a stage's kind to that stage.
-- The statements that assign check the Capability and the caps; ending the
-- engagement deletes its assignments, and so every route through them.
CREATE TABLE vetchium.org_engagement_assignments (
    assignment_id uuid PRIMARY KEY,
    engagement_id uuid NOT NULL REFERENCES vetchium.org_engagements
        (engagement_id) ON DELETE CASCADE,
    org_opening_id uuid NOT NULL REFERENCES vetchium.org_openings
        (org_opening_id) ON DELETE CASCADE,
    -- NULL assigns the engagement to the whole Opening.
    org_opening_stage_id uuid,
    assigned_by uuid REFERENCES vetchium.org_users (org_user_id)
        ON DELETE SET NULL,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_engagement_assignments_stage_fkey
        FOREIGN KEY (org_opening_stage_id, org_opening_id)
        REFERENCES vetchium.org_opening_stages
        (org_opening_stage_id, org_opening_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX org_engagement_assignments_opening_key
    ON vetchium.org_engagement_assignments (engagement_id, org_opening_id)
    WHERE org_opening_stage_id IS NULL;
CREATE UNIQUE INDEX org_engagement_assignments_stage_key
    ON vetchium.org_engagement_assignments (engagement_id, org_opening_stage_id)
    WHERE org_opening_stage_id IS NOT NULL;
CREATE INDEX org_engagement_assignments_list_idx
    ON vetchium.org_engagement_assignments
    (org_opening_id, assigned_at, assignment_id);

-- The provider performing a candidacy's current stage, through an assignment
-- of that stage. A candidacy has at most one route, and only while it is at
-- the stage: every statement that moves or ends a candidacy calls
-- end_provider_access. The consent disclosure and check types of a
-- `background_check` Listing are copied from the provider's tenant when the
-- candidacy is routed (MKT-DAT-009).
CREATE TABLE vetchium.org_application_routes (
    org_application_id uuid PRIMARY KEY REFERENCES vetchium.org_applications
        (org_application_id) ON DELETE CASCADE,
    -- What the provider calls the work. Routing again makes a new one, so an
    -- old id never reaches new work and the provider never learns an
    -- application number.
    route_id uuid NOT NULL UNIQUE,
    assignment_id uuid NOT NULL REFERENCES
        vetchium.org_engagement_assignments (assignment_id) ON DELETE CASCADE,
    consent_disclosure text,
    listing_check_types text[] NOT NULL DEFAULT '{}',
    routed_by uuid REFERENCES vetchium.org_users (org_user_id)
        ON DELETE SET NULL,
    routed_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_application_routes_disclosure_check CHECK (
        consent_disclosure IS NULL OR (
            consent_disclosure = btrim(consent_disclosure)
            AND char_length(consent_disclosure) BETWEEN 1 AND 5000
        )
    ),
    CONSTRAINT org_application_routes_check_types_check CHECK (
        cardinality(listing_check_types) <= 20
    )
);
CREATE INDEX org_application_routes_assignment_idx
    ON vetchium.org_application_routes (assignment_id);

-- History holds numbers, actions, states, and dates, never notes, feedback,
-- or snapshot text.
CREATE TABLE vetchium.org_application_history (
    org_application_history_id uuid PRIMARY KEY,
    org_application_id uuid NOT NULL REFERENCES vetchium.org_applications
        (org_application_id) ON DELETE CASCADE,
    action vetchium.org_application_history_action NOT NULL,
    actor_kind vetchium.org_application_actor_kind NOT NULL,
    actor_org_user_id uuid REFERENCES vetchium.org_users (org_user_id)
        ON DELETE SET NULL,
    application_state vetchium.org_application_state NOT NULL,
    application_version integer NOT NULL CHECK (application_version >= 1),
    -- The stage a shortlist, move, or completion concerns, and the dates a
    -- joining or separation entry records.
    org_opening_stage_id uuid REFERENCES vetchium.org_opening_stages
        (org_opening_stage_id) ON DELETE SET NULL,
    joined_on date,
    separated_on date,
    -- The interview an interview action concerns.
    interview_number integer CHECK (interview_number >= 1),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_application_history_actor_check CHECK (
        actor_org_user_id IS NULL OR actor_kind = 'org_user'
    )
);
CREATE INDEX org_application_history_list_idx
    ON vetchium.org_application_history
    (org_application_id, created_at DESC, org_application_history_id DESC);

-- Offer letters (agent-guides/object-storage.md, Offer letters): the
-- database owns their metadata and lifecycle, the tenant's object store the
-- bytes. An Org user holds at most one unclaimed (uploading or uploaded)
-- letter; an offer claims it (active), and an active letter is never queued
-- for deletion while its offer references it.
CREATE TYPE vetchium.org_offer_letter_state AS ENUM (
    'uploading', 'uploaded', 'active', 'pending_delete'
);
CREATE TABLE vetchium.org_offer_letter_objects (
    object_id uuid PRIMARY KEY,
    org_did uuid NOT NULL REFERENCES vetchium.orgs (org_did)
        ON DELETE CASCADE,
    uploaded_by uuid REFERENCES vetchium.org_users (org_user_id)
        ON DELETE SET NULL,
    byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
    content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
    state vetchium.org_offer_letter_state NOT NULL DEFAULT 'uploading',
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_token uuid,
    leased_until timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    upload_expires_at timestamptz,
    delete_requested_at timestamptz,
    CONSTRAINT org_offer_letter_objects_state_check CHECK (
        (state IN ('uploading', 'uploaded') AND upload_expires_at IS NOT NULL
            AND delete_requested_at IS NULL) OR
        (state = 'active' AND upload_expires_at IS NULL AND
            delete_requested_at IS NULL) OR
        (state = 'pending_delete' AND upload_expires_at IS NULL AND
            delete_requested_at IS NOT NULL)
    ),
    CONSTRAINT org_offer_letter_objects_lease_check CHECK (
        (lease_token IS NULL) = (leased_until IS NULL)
    )
);
CREATE UNIQUE INDEX org_offer_letter_objects_unclaimed_idx
    ON vetchium.org_offer_letter_objects (uploaded_by)
    WHERE state IN ('uploading', 'uploaded');
CREATE INDEX org_offer_letter_objects_expiry_idx
    ON vetchium.org_offer_letter_objects (upload_expires_at)
    WHERE state IN ('uploading', 'uploaded');
CREATE INDEX org_offer_letter_objects_deletion_idx
    ON vetchium.org_offer_letter_objects (next_attempt_at)
    WHERE state = 'pending_delete';

-- Offers of an application, numbered per application. At most one awaits an
-- answer (extended); every other status is final, with ended_at.
CREATE TYPE vetchium.org_application_offer_status AS ENUM (
    'extended', 'accepted', 'declined', 'expired', 'withdrawn'
);
CREATE TABLE vetchium.org_application_offers (
    org_application_offer_id uuid PRIMARY KEY,
    org_application_id uuid NOT NULL REFERENCES vetchium.org_applications
        (org_application_id) ON DELETE CASCADE,
    offer_number integer NOT NULL CHECK (offer_number >= 1),
    -- Deferred: deleting an Org cascades to its letters and, through its
    -- applications, to these offers within one statement.
    letter_object_id uuid NOT NULL UNIQUE
        REFERENCES vetchium.org_offer_letter_objects (object_id)
        DEFERRABLE INITIALLY DEFERRED,
    proposed_joining_date date,
    respond_by timestamptz NOT NULL,
    offer_status vetchium.org_application_offer_status NOT NULL
        DEFAULT 'extended',
    extended_by uuid REFERENCES vetchium.org_users (org_user_id)
        ON DELETE SET NULL,
    extended_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    -- Set once the applicant was told the offer is about to expire.
    expiring_notified_at timestamptz,
    CONSTRAINT org_application_offers_number_key
        UNIQUE (org_application_id, offer_number),
    CONSTRAINT org_application_offers_ended_check CHECK (
        (offer_status = 'extended') = (ended_at IS NULL)
    ),
    CONSTRAINT org_application_offers_deadline_check CHECK (
        respond_by > extended_at
    )
);
CREATE UNIQUE INDEX org_application_offers_extended_idx
    ON vetchium.org_application_offers (org_application_id)
    WHERE offer_status = 'extended';
CREATE INDEX org_application_offers_expiry_idx
    ON vetchium.org_application_offers (respond_by)
    WHERE offer_status = 'extended';

-- Interviews of a candidacy (HP-WRK-002 to HP-WRK-004), numbered per
-- application. Every writer holds the application's row lock, which
-- serializes numbering and the per-stage limit. Details, the applicant's
-- response, and feedback are deleted by retention with the application.
CREATE TYPE vetchium.org_interview_mode AS ENUM ('video', 'in_person');
CREATE TYPE vetchium.org_interview_state AS ENUM (
    'scheduled', 'completed', 'no_show', 'cancelled'
);
CREATE TYPE vetchium.org_interview_response AS ENUM (
    'pending', 'accepted', 'reschedule_requested'
);
CREATE TYPE vetchium.org_interview_recommendation AS ENUM (
    'strong_yes', 'yes', 'no', 'strong_no'
);
-- The id is a UUIDv7, so id order is scheduling order and serves the
-- interviewer's list.
CREATE TABLE vetchium.org_interviews (
    org_interview_id uuid PRIMARY KEY,
    org_application_id uuid NOT NULL REFERENCES vetchium.org_applications
        (org_application_id) ON DELETE CASCADE,
    interview_number integer NOT NULL CHECK (interview_number >= 1),
    org_opening_stage_id uuid NOT NULL REFERENCES vetchium.org_opening_stages
        (org_opening_stage_id) ON DELETE CASCADE,
    starts_at timestamptz NOT NULL,
    duration_minutes smallint NOT NULL
        CHECK (duration_minutes BETWEEN 15 AND 480),
    interview_mode vetchium.org_interview_mode NOT NULL,
    video_url text,
    location text,
    interview_state vetchium.org_interview_state NOT NULL DEFAULT 'scheduled',
    applicant_response vetchium.org_interview_response NOT NULL
        DEFAULT 'pending',
    reschedule_note text,
    scheduled_by uuid REFERENCES vetchium.org_users (org_user_id)
        ON DELETE SET NULL,
    -- The provider that scheduled and holds the interview; its interviewers
    -- and feedback are in the org_provider_interview_* tables.
    performer_engagement_id uuid REFERENCES vetchium.org_engagements
        (engagement_id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    -- When the interview was recorded, cancelled, or otherwise ended.
    ended_at timestamptz,
    CONSTRAINT org_interviews_number_key
        UNIQUE (org_application_id, interview_number),
    CONSTRAINT org_interviews_mode_check CHECK (
        (interview_mode = 'video' AND video_url IS NOT NULL
            AND location IS NULL) OR
        (interview_mode = 'in_person' AND location IS NOT NULL
            AND video_url IS NULL)
    ),
    CONSTRAINT org_interviews_video_url_check CHECK (
        video_url IS NULL OR (
            video_url ~ '^https://[!-~]+$' AND char_length(video_url) <= 2048
        )
    ),
    CONSTRAINT org_interviews_location_check CHECK (
        location IS NULL OR (
            location = btrim(location) AND char_length(location) BETWEEN 1 AND 500
        )
    ),
    CONSTRAINT org_interviews_reschedule_note_check CHECK (
        (applicant_response = 'reschedule_requested') =
            (reschedule_note IS NOT NULL)
        AND (reschedule_note IS NULL OR (
            reschedule_note = btrim(reschedule_note)
            AND char_length(reschedule_note) BETWEEN 1 AND 500
        ))
    ),
    CONSTRAINT org_interviews_ended_check CHECK (
        (interview_state = 'scheduled') = (ended_at IS NULL)
    ),
    CONSTRAINT org_interviews_timestamps_check CHECK (
        updated_at >= created_at
    )
);
CREATE INDEX org_interviews_stage_idx
    ON vetchium.org_interviews (org_opening_stage_id);

CREATE TABLE vetchium.org_interview_interviewers (
    org_interview_id uuid NOT NULL REFERENCES vetchium.org_interviews
        (org_interview_id) ON DELETE CASCADE,
    org_user_id uuid NOT NULL REFERENCES vetchium.org_users (org_user_id)
        ON DELETE CASCADE,
    PRIMARY KEY (org_interview_id, org_user_id)
);
CREATE INDEX org_interview_interviewers_user_idx
    ON vetchium.org_interview_interviewers (org_user_id, org_interview_id DESC);

-- Once per interviewer; only an interviewer of the interview can submit.
CREATE TABLE vetchium.org_interview_feedback (
    org_interview_id uuid NOT NULL,
    org_user_id uuid NOT NULL,
    recommendation vetchium.org_interview_recommendation NOT NULL,
    notes text NOT NULL,
    submitted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_interview_id, org_user_id),
    FOREIGN KEY (org_interview_id, org_user_id)
        REFERENCES vetchium.org_interview_interviewers
        (org_interview_id, org_user_id) ON DELETE CASCADE,
    CONSTRAINT org_interview_feedback_notes_check CHECK (
        notes = btrim(notes) AND char_length(notes) BETWEEN 1 AND 10000
    )
);

-- The interviewers and feedback of an interview a provider holds. A provider's
-- user is known to the client only by email address.
CREATE TABLE vetchium.org_provider_interview_interviewers (
    org_interview_id uuid NOT NULL REFERENCES vetchium.org_interviews
        (org_interview_id) ON DELETE CASCADE,
    interviewer_email text NOT NULL
        CHECK (interviewer_email = lower(btrim(interviewer_email))
            AND char_length(interviewer_email) BETWEEN 3 AND 254),
    PRIMARY KEY (org_interview_id, interviewer_email)
);

CREATE TABLE vetchium.org_provider_interview_feedback (
    org_interview_id uuid NOT NULL,
    interviewer_email text NOT NULL,
    recommendation vetchium.org_interview_recommendation NOT NULL,
    notes text NOT NULL,
    submitted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_interview_id, interviewer_email),
    FOREIGN KEY (org_interview_id, interviewer_email)
        REFERENCES vetchium.org_provider_interview_interviewers
        (org_interview_id, interviewer_email) ON DELETE CASCADE,
    CONSTRAINT org_provider_interview_feedback_notes_check CHECK (
        notes = btrim(notes) AND char_length(notes) BETWEEN 1 AND 10000
    )
);

-- Leaving the pipeline cancels the upcoming interviews of the applications
-- (HP-STA-002). Every statement that ends a candidacy calls it in the same
-- statement, so no exit can leave an interview scheduled.
CREATE FUNCTION vetchium.cancel_upcoming_interviews(application_ids uuid[])
RETURNS integer
LANGUAGE sql VOLATILE
AS $$
    WITH cancelled AS (
        UPDATE vetchium.org_interviews AS i
        SET interview_state = 'cancelled', ended_at = now(), updated_at = now()
        WHERE i.org_application_id = ANY(application_ids)
          AND i.interview_state = 'scheduled'
          AND i.starts_at > now()
        RETURNING i.org_interview_id
    )
    SELECT count(*)::integer FROM cancelled
$$;

-- Assessment results (HP-WRK-005): one per candidacy and assessment stage.
-- Recording completes the stage, so a second result finds the stage done.
CREATE TYPE vetchium.org_assessment_outcome AS ENUM (
    'pass', 'fail', 'inconclusive'
);
CREATE TABLE vetchium.org_application_assessments (
    org_application_id uuid NOT NULL REFERENCES vetchium.org_applications
        (org_application_id) ON DELETE CASCADE,
    org_opening_stage_id uuid NOT NULL REFERENCES vetchium.org_opening_stages
        (org_opening_stage_id) ON DELETE CASCADE,
    outcome vetchium.org_assessment_outcome NOT NULL,
    score smallint CHECK (score BETWEEN 0 AND 100),
    notes text,
    report_url text,
    recorded_by uuid REFERENCES vetchium.org_users (org_user_id)
        ON DELETE SET NULL,
    -- A provider's result: the engagement and the provider user's email.
    performer_engagement_id uuid REFERENCES vetchium.org_engagements
        (engagement_id) ON DELETE CASCADE,
    recorded_by_email text,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_application_id, org_opening_stage_id),
    CONSTRAINT org_application_assessments_notes_check CHECK (
        notes IS NULL OR (
            notes = btrim(notes) AND char_length(notes) BETWEEN 1 AND 2000
        )
    ),
    CONSTRAINT org_application_assessments_report_url_check CHECK (
        report_url IS NULL OR (
            report_url ~ '^https://[!-~]+$' AND char_length(report_url) <= 2048
        )
    )
);

-- Background checks (HP-WRK-006): a consent request per candidacy and
-- background_check stage, numbered per application. Nothing is recorded
-- until the applicant gives consent. A request is active while requested or
-- given; a declined or ended one lets the Org ask again. Ending happens when
-- the candidacy leaves the pipeline or the stage.
CREATE TYPE vetchium.org_consent_state AS ENUM (
    'requested', 'given', 'declined', 'ended'
);
CREATE TYPE vetchium.org_check_outcome AS ENUM (
    'clear', 'discrepancy', 'unable_to_verify'
);
CREATE TABLE vetchium.org_background_checks (
    org_background_check_id uuid PRIMARY KEY,
    org_application_id uuid NOT NULL REFERENCES vetchium.org_applications
        (org_application_id) ON DELETE CASCADE,
    check_number integer NOT NULL CHECK (check_number >= 1),
    org_opening_stage_id uuid NOT NULL REFERENCES vetchium.org_opening_stages
        (org_opening_stage_id) ON DELETE CASCADE,
    check_types text[] NOT NULL,
    consent_state vetchium.org_consent_state NOT NULL DEFAULT 'requested',
    requested_by uuid REFERENCES vetchium.org_users (org_user_id)
        ON DELETE SET NULL,
    -- The provider that performs the checks, and the text copied from its
    -- Listing when the candidacy was routed, which the applicant consents to
    -- and which stays with the result as evidence (MKT-DAT-009).
    performer_engagement_id uuid REFERENCES vetchium.org_engagements
        (engagement_id) ON DELETE CASCADE,
    consent_disclosure text,
    requested_at timestamptz NOT NULL DEFAULT now(),
    responded_at timestamptz,
    CONSTRAINT org_background_checks_performer_check CHECK (
        (performer_engagement_id IS NULL) = (consent_disclosure IS NULL)
    ),
    CONSTRAINT org_background_checks_number_key
        UNIQUE (org_application_id, check_number),
    CONSTRAINT org_background_checks_types_check CHECK (
        cardinality(check_types) BETWEEN 1 AND 20
    ),
    CONSTRAINT org_background_checks_responded_check CHECK (
        (consent_state IN ('given', 'declined')) = (responded_at IS NOT NULL)
    )
);
CREATE UNIQUE INDEX org_background_checks_active_idx
    ON vetchium.org_background_checks (org_application_id, org_opening_stage_id)
    WHERE consent_state IN ('requested', 'given');

CREATE TABLE vetchium.org_background_check_results (
    org_background_check_id uuid NOT NULL REFERENCES
        vetchium.org_background_checks (org_background_check_id)
        ON DELETE CASCADE,
    check_type text NOT NULL,
    outcome vetchium.org_check_outcome NOT NULL,
    notes text,
    report_url text,
    recorded_by uuid REFERENCES vetchium.org_users (org_user_id)
        ON DELETE SET NULL,
    -- A provider user's email, when the check's performer is a provider.
    recorded_by_email text,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_background_check_id, check_type),
    CONSTRAINT org_background_check_results_notes_check CHECK (
        notes IS NULL OR (
            notes = btrim(notes) AND char_length(notes) BETWEEN 1 AND 2000
        )
    ),
    CONSTRAINT org_background_check_results_report_url_check CHECK (
        report_url IS NULL OR (
            report_url ~ '^https://[!-~]+$' AND char_length(report_url) <= 2048
        )
    )
);

-- Leaving the pipeline ends the consent requests still awaiting an answer,
-- as it cancels the upcoming interviews (HP-STA-002). Every statement that
-- ends a candidacy or moves it off a stage calls it in the same statement.
CREATE FUNCTION vetchium.end_pending_consents(application_ids uuid[])
RETURNS integer
LANGUAGE sql VOLATILE
AS $$
    WITH ended AS (
        UPDATE vetchium.org_background_checks AS b
        SET consent_state = 'ended'
        WHERE b.org_application_id = ANY(application_ids)
          AND b.consent_state = 'requested'
        RETURNING b.org_background_check_id
    )
    SELECT count(*)::integer FROM ended
$$;

-- Leaving the pipeline or the stage ends every provider's access to the
-- candidacy (HP-STA-002, MKT-ACC-004): a candidacy is reachable by a provider
-- only through its route. Called beside end_pending_consents.
CREATE FUNCTION vetchium.end_provider_access(application_ids uuid[])
RETURNS integer
LANGUAGE sql VOLATILE
AS $$
    WITH ended AS (
        DELETE FROM vetchium.org_application_routes AS r
        WHERE r.org_application_id = ANY(application_ids)
        RETURNING r.org_application_id
    )
    SELECT count(*)::integer FROM ended
$$;

-- What a provider's work item is waiting for, from the stage the candidacy is
-- at and the provider's own interviews and consent request there.
CREATE FUNCTION vetchium.provider_work_status(
    application_id uuid, stage_id uuid, engagement_id uuid
) RETURNS text
LANGUAGE sql STABLE
AS $$
    SELECT CASE
        WHEN EXISTS (
            SELECT 1 FROM vetchium.org_application_stages AS r
            WHERE r.org_application_id = application_id
              AND r.org_opening_stage_id = stage_id
              AND r.stage_status = 'completed'
        ) THEN 'completed'
        WHEN s.stage_kind = 'background_check' THEN CASE
            WHEN EXISTS (
                SELECT 1 FROM vetchium.org_background_checks AS b
                WHERE b.org_application_id = application_id
                  AND b.org_opening_stage_id = stage_id
                  AND b.performer_engagement_id = engagement_id
                  AND b.consent_state = 'requested'
            ) THEN 'awaiting_consent'
            WHEN EXISTS (
                SELECT 1 FROM vetchium.org_background_checks AS b
                WHERE b.org_application_id = application_id
                  AND b.org_opening_stage_id = stage_id
                  AND b.performer_engagement_id = engagement_id
                  AND b.consent_state = 'given'
            ) THEN 'in_progress'
            ELSE 'pending' END
        WHEN s.stage_kind = 'interview' THEN CASE
            WHEN EXISTS (
                SELECT 1 FROM vetchium.org_interviews AS i
                WHERE i.org_application_id = application_id
                  AND i.org_opening_stage_id = stage_id
                  AND i.performer_engagement_id = engagement_id
                  AND i.interview_state = 'scheduled'
            ) THEN 'scheduled'
            WHEN EXISTS (
                SELECT 1 FROM vetchium.org_interviews AS i
                WHERE i.org_application_id = application_id
                  AND i.org_opening_stage_id = stage_id
                  AND i.performer_engagement_id = engagement_id
                  AND i.interview_state <> 'cancelled'
            ) THEN 'in_progress'
            ELSE 'pending' END
        ELSE 'pending' END
    FROM vetchium.org_opening_stages AS s
    WHERE s.org_opening_stage_id = stage_id
$$;

-- The status the applicant sees (HP-HUB-001), for a read that filters or
-- orders by it in SQL. hubapplications.Status derives the same in Go; a test
-- keeps the two in agreement. An unknown state has none.
CREATE FUNCTION vetchium.hub_application_status(
    state vetchium.org_application_state,
    stage_kind vetchium.pipeline_stage_kind
) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE
        WHEN state = 'submitted' THEN 'applied'
        WHEN state = 'in_pipeline' AND stage_kind = 'interview'
            THEN 'interviewing'
        WHEN state = 'in_pipeline' THEN 'in_review'
        WHEN state IN ('offered', 'offer_accepted') THEN 'offer'
        WHEN state = 'joined' THEN 'hired'
        WHEN state IN ('not_progressing', 'offer_declined', 'did_not_join')
            THEN 'not_progressing'
        WHEN state = 'withdrawn' THEN 'withdrawn'
    END
$$;

-- Who may read all of an Opening's applications: the hiring manager, the
-- recruiter, a hiring-team member, or a holder of org:manage_candidacies.
-- org:view_openings grants none of it.
CREATE FUNCTION vetchium.org_user_reads_all_applications(
    opening_id uuid, user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM vetchium.org_effective_permissions AS ep
        WHERE ep.org_user_id = user_id
          AND ep.permission = 'org:manage_candidacies'
    ) OR EXISTS (
        SELECT 1 FROM vetchium.org_openings AS o
        WHERE o.org_opening_id = opening_id
          AND (o.hiring_manager_id = user_id OR o.recruiter_id = user_id)
    ) OR EXISTS (
        SELECT 1 FROM vetchium.org_opening_team_members AS tm
        WHERE tm.org_opening_id = opening_id AND tm.org_user_id = user_id
    )
$$;

-- Who may read an Opening's applications: those who read all of them, and an
-- interviewer of one, who reads only the candidacies of their interviews
-- (HP-AUTH-003): with application_id, that application; without it, the
-- Opening as a whole, which an interviewer of any of its applications may
-- open. Every Orgs application read applies this predicate in SQL so a
-- revoked grant takes effect on a stale session.
CREATE FUNCTION vetchium.org_user_reads_applications(
    opening_id uuid, user_id uuid, application_id uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE
AS $$
    SELECT vetchium.org_user_reads_all_applications(opening_id, user_id)
    OR EXISTS (
        SELECT 1
        FROM vetchium.org_interview_interviewers AS iv
        JOIN vetchium.org_interviews AS i
            ON i.org_interview_id = iv.org_interview_id
        JOIN vetchium.org_applications AS a
            ON a.org_application_id = i.org_application_id
        WHERE iv.org_user_id = user_id
          AND a.org_opening_id = opening_id
          AND (application_id IS NULL OR a.org_application_id = application_id)
    )
$$;

-- Who may act on an Opening's applications: its hiring manager, its
-- recruiter, or a holder of org:manage_candidacies. Hiring-team members only
-- read (HP-AUTH-002). Acting implies reading.
CREATE FUNCTION vetchium.org_user_acts_on_applications(
    opening_id uuid, user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM vetchium.org_effective_permissions AS ep
        WHERE ep.org_user_id = user_id
          AND ep.permission = 'org:manage_candidacies'
    ) OR EXISTS (
        SELECT 1 FROM vetchium.org_openings AS o
        WHERE o.org_opening_id = opening_id
          AND (o.hiring_manager_id = user_id OR o.recruiter_id = user_id)
    )
$$;

-- The Hub user's non-authoritative projection of their applications, written
-- only by hub-application-changed events from the Org's tenant (HP-GEN-004);
-- the inbox watermark keeps an older event from overwriting a newer row. It
-- holds no stage name, feedback, or Org user data. The Org may live in
-- another tenant, so org_did has no foreign key.
CREATE TABLE vetchium.hub_application_projections (
    projection_id uuid PRIMARY KEY,
    hub_user_did uuid NOT NULL REFERENCES vetchium.hub_users (hub_user_did)
        ON DELETE CASCADE,
    org_did uuid NOT NULL,
    org_domain vetchium.org_domain NOT NULL,
    org_display_name text NOT NULL CHECK (length(btrim(org_display_name)) > 0),
    opening_number integer NOT NULL CHECK (opening_number >= 1),
    opening_title text NOT NULL CHECK (length(btrim(opening_title)) > 0),
    application_number integer NOT NULL CHECK (application_number >= 1),
    hub_status text NOT NULL CHECK (hub_status IN (
        'applied', 'in_review', 'interviewing', 'offer', 'hired',
        'not_progressing', 'withdrawn'
    )),
    pending_actions text[] NOT NULL CHECK (
        pending_actions <@ ARRAY['interview_response',
            'background_check_consent', 'offer_response']::text[]
    ),
    applied_at timestamptz NOT NULL,
    last_activity_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT hub_application_projections_application_key
        UNIQUE (hub_user_did, org_did, opening_number, application_number),
    CONSTRAINT hub_application_projections_activity_check CHECK (
        last_activity_at >= applied_at
    )
);
CREATE INDEX hub_application_projections_list_idx
    ON vetchium.hub_application_projections
    (hub_user_did, last_activity_at DESC, projection_id DESC);

-- What a projection event tells the applicant (HP-GEN-006): one row per
-- notification, written beside the projection and turned into an outbox
-- email by the workers, which hold the outbox key. It names no interview,
-- offer, or result content.
CREATE TABLE vetchium.hub_application_notices (
    notice_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hub_user_did uuid NOT NULL REFERENCES vetchium.hub_users (hub_user_did)
        ON DELETE CASCADE,
    notice text NOT NULL CHECK (notice IN (
        'status_changed', 'interview_scheduled', 'interview_changed',
        'interview_cancelled', 'consent_requested', 'offer_extended',
        'offer_withdrawn', 'offer_expiring', 'offer_expired'
    )),
    org_display_name text NOT NULL CHECK (length(btrim(org_display_name)) > 0),
    opening_title text NOT NULL CHECK (length(btrim(opening_title)) > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hub_application_notices_queue_idx
    ON vetchium.hub_application_notices (created_at, notice_id);

-- AI assistance (agent-guides/ai.md). Model identifiers, prices, and packs
-- belong to the tenant configuration, so none of these tables references a
-- model catalog.
CREATE TABLE vetchium.org_ai_settings (
    org_did uuid PRIMARY KEY REFERENCES vetchium.orgs (org_did)
        ON DELETE CASCADE,
    enabled boolean NOT NULL DEFAULT false,
    accepted_terms_version text
        CHECK (accepted_terms_version ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
    accepted_terms_by uuid REFERENCES vetchium.org_users (org_user_id)
        ON DELETE SET NULL,
    accepted_terms_at timestamptz,
    updated_by uuid NOT NULL REFERENCES vetchium.org_users (org_user_id)
        ON DELETE CASCADE,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_ai_settings_enabled_needs_terms CHECK (
        NOT enabled OR accepted_terms_version IS NOT NULL
    ),
    CONSTRAINT org_ai_settings_terms_consistent CHECK (
        (accepted_terms_version IS NULL) = (accepted_terms_at IS NULL)
    )
);

CREATE TABLE vetchium.org_ai_operation_policies (
    org_did uuid NOT NULL REFERENCES vetchium.orgs (org_did)
        ON DELETE CASCADE,
    operation text NOT NULL
        CHECK (operation ~ '^org-[a-z0-9]+(-[a-z0-9]+)*$'),
    allowed_models text[] NOT NULL,
    default_model text,
    PRIMARY KEY (org_did, operation),
    -- No allowed model turns the operation off for the Org.
    CONSTRAINT org_ai_operation_policies_models_check CHECK (
        (cardinality(allowed_models) = 0 AND default_model IS NULL)
        OR (
            cardinality(allowed_models) BETWEEN 1 AND 20
            AND array_position(allowed_models, NULL) IS NULL
            AND vetchium.array_is_distinct(allowed_models)
            AND default_model = ANY(allowed_models)
        )
    )
);

CREATE TYPE vetchium.org_ai_credit_lot_kind AS ENUM ('grant', 'purchase');

-- A grant lapses at the end of its UTC month and is usable only while the plan
-- allows AI; a purchase expires twelve months after it and stays usable on any
-- plan. Spending takes the grant first, then purchases by earliest expiry.
CREATE TABLE vetchium.org_ai_credit_lots (
    lot_id uuid PRIMARY KEY,
    org_did uuid NOT NULL REFERENCES vetchium.orgs (org_did)
        ON DELETE CASCADE,
    kind vetchium.org_ai_credit_lot_kind NOT NULL,
    grant_month date,
    pack_id text CHECK (pack_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    purchased_by uuid REFERENCES vetchium.org_users (org_user_id)
        ON DELETE SET NULL,
    credits_granted bigint NOT NULL CHECK (credits_granted > 0),
    credits_remaining bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    CONSTRAINT org_ai_credit_lots_remaining_check CHECK (
        credits_remaining BETWEEN 0 AND credits_granted
    ),
    CONSTRAINT org_ai_credit_lots_kind_check CHECK (
        CASE kind
            WHEN 'grant' THEN grant_month IS NOT NULL
                AND grant_month = date_trunc('month', grant_month)::date
                AND pack_id IS NULL AND purchased_by IS NULL
            ELSE grant_month IS NULL AND pack_id IS NOT NULL
        END
    ),
    CONSTRAINT org_ai_credit_lots_expiry_check CHECK (expires_at > created_at),
    CONSTRAINT org_ai_credit_lots_one_grant_per_month UNIQUE (
        org_did, grant_month
    )
);
-- Serves the history's keyset order and the balance's per-Org scan.
CREATE INDEX org_ai_credit_lots_list_idx
    ON vetchium.org_ai_credit_lots (org_did, created_at DESC, lot_id DESC);

CREATE TYPE vetchium.org_ai_usage_state AS ENUM (
    'reserved', 'settled', 'released', 'abandoned'
);
CREATE TYPE vetchium.org_ai_failure_reason AS ENUM (
    'model_failed', 'unusable_output', 'abandoned'
);

-- One row per model call. The reservation holds credits_reserved against the
-- balance while the call runs; settling charges at most that much.
CREATE TABLE vetchium.org_ai_usage (
    usage_id uuid PRIMARY KEY,
    org_did uuid NOT NULL REFERENCES vetchium.orgs (org_did)
        ON DELETE CASCADE,
    org_user_id uuid NOT NULL REFERENCES vetchium.org_users (org_user_id)
        ON DELETE CASCADE,
    operation text NOT NULL
        CHECK (operation ~ '^org-[a-z0-9]+(-[a-z0-9]+)*$'),
    model_oid text NOT NULL CHECK (model_oid ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    host_model text NOT NULL CHECK (length(host_model) BETWEEN 1 AND 200),
    input_credits_per_million bigint NOT NULL
        CHECK (input_credits_per_million >= 0),
    output_credits_per_million bigint NOT NULL
        CHECK (output_credits_per_million >= 0),
    usage_state vetchium.org_ai_usage_state NOT NULL DEFAULT 'reserved',
    failure_reason vetchium.org_ai_failure_reason,
    credits_reserved bigint NOT NULL CHECK (credits_reserved > 0),
    credits_charged bigint NOT NULL DEFAULT 0,
    input_tokens integer CHECK (input_tokens >= 0),
    output_tokens integer CHECK (output_tokens >= 0),
    idempotency_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    CONSTRAINT org_ai_usage_finished_check CHECK (
        (usage_state = 'reserved') = (finished_at IS NULL)
    ),
    CONSTRAINT org_ai_usage_charge_check CHECK (
        credits_charged BETWEEN 0 AND credits_reserved
        AND (usage_state = 'settled' OR credits_charged = 0)
    ),
    CONSTRAINT org_ai_usage_failure_check CHECK (
        (failure_reason IS NOT NULL)
        = (usage_state IN ('released', 'abandoned'))
    ),
    CONSTRAINT org_ai_usage_tokens_check CHECK (
        usage_state <> 'settled'
        OR (input_tokens IS NOT NULL AND output_tokens IS NOT NULL)
    )
);
-- A retry with the same key waits for, rather than doubles, a call in flight.
CREATE UNIQUE INDEX org_ai_usage_one_reserved_per_key_idx
    ON vetchium.org_ai_usage (org_user_id, idempotency_key)
    WHERE usage_state = 'reserved';
-- An Org may hold millions of calls; the usage list reads one keyset page.
CREATE INDEX org_ai_usage_list_idx
    ON vetchium.org_ai_usage (org_did, created_at DESC, usage_id DESC);
-- Calls in flight are few, so the balance's held sum and the reaper's scan
-- both read this small index rather than an Org's whole history.
CREATE INDEX org_ai_usage_reserved_idx
    ON vetchium.org_ai_usage (org_did, created_at, usage_id)
    WHERE usage_state = 'reserved';

-- The prompt sent and the answer received, deleted by a worker at expires_at.
CREATE TABLE vetchium.org_ai_usage_texts (
    usage_id uuid PRIMARY KEY REFERENCES vetchium.org_ai_usage (usage_id)
        ON DELETE CASCADE,
    request_messages jsonb NOT NULL
        CHECK (jsonb_typeof(request_messages) = 'array'),
    response_text text,
    expires_at timestamptz NOT NULL
);
CREATE INDEX org_ai_usage_texts_expiry_idx
    ON vetchium.org_ai_usage_texts (expires_at, usage_id);

-- Agency Contacts and notes (agent-guides/marketplace.md, Agency contacts).
-- The agency's tenant is authoritative. The Hub user is a DID and the name and
-- handle last read, never a reference, because the account may live in
-- another tenant.
CREATE TABLE vetchium.org_contacts (
    contact_id uuid PRIMARY KEY,
    org_did uuid NOT NULL REFERENCES vetchium.orgs (org_did)
        ON DELETE CASCADE,
    hub_user_did uuid NOT NULL,
    display_name text NOT NULL,
    handle text NOT NULL,
    -- The Hub user's "Agencies may message me" is off (MKT-DAT-006).
    messages_off boolean NOT NULL DEFAULT false,
    -- Versions the agency pointer the Hub user's tenant keeps; the event that
    -- deletes it carries the next version.
    pointer_version integer NOT NULL DEFAULT 1 CHECK (pointer_version >= 1),
    created_by uuid NOT NULL REFERENCES vetchium.org_users (org_user_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- The last note write or message, from which retention counts.
    last_activity_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_contacts_id_uuidv7_check CHECK (
        substring(contact_id::text FROM 15 FOR 1) = '7'
    ),
    CONSTRAINT org_contacts_names_check CHECK (
        display_name = btrim(display_name)
        AND char_length(display_name) BETWEEN 1 AND 200
        AND handle ~ '^[a-z0-9]{8}-[0-9a-hjkmnp-tv-z]{11}$'
    ),
    CONSTRAINT org_contacts_activity_check CHECK (
        last_activity_at >= created_at
    )
);
CREATE UNIQUE INDEX org_contacts_person_key
    ON vetchium.org_contacts (org_did, hub_user_did);
CREATE INDEX org_contacts_list_idx
    ON vetchium.org_contacts (org_did, last_activity_at DESC, contact_id DESC);
CREATE INDEX org_contacts_retention_idx
    ON vetchium.org_contacts (last_activity_at, contact_id);
-- A deleted Hub account removes the notes of every agency at once.
CREATE INDEX org_contacts_person_idx
    ON vetchium.org_contacts (hub_user_did);

CREATE TABLE vetchium.org_contact_notes (
    note_id uuid PRIMARY KEY,
    contact_id uuid NOT NULL REFERENCES vetchium.org_contacts (contact_id)
        ON DELETE CASCADE,
    -- A disabled user's notes stay under their email address.
    author_id uuid NOT NULL REFERENCES vetchium.org_users (org_user_id),
    note_text text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    edited_at timestamptz,
    CONSTRAINT org_contact_notes_text_check CHECK (
        note_text = btrim(note_text)
        AND char_length(note_text) BETWEEN 1 AND 5000
    ),
    CONSTRAINT org_contact_notes_edited_check CHECK (
        edited_at IS NULL OR edited_at >= created_at
    )
);
CREATE INDEX org_contact_notes_list_idx
    ON vetchium.org_contact_notes (contact_id, created_at DESC, note_id DESC);

-- New Contacts per agency per UTC day (MKT-CON-005). A count of live rows
-- would let an agency delete and recreate Contacts past the limit.
CREATE TABLE vetchium.org_contact_creations (
    org_did uuid NOT NULL REFERENCES vetchium.orgs (org_did)
        ON DELETE CASCADE,
    created_on date NOT NULL,
    created integer NOT NULL CHECK (created >= 1),
    PRIMARY KEY (org_did, created_on)
);

-- Conversations between an agency and a Hub user (MKT-CNV-001).
-- Rows have no cascading reference to orgs (MKT-CNV-012) and hold the Hub user
-- by DID only, so deleting either party leaves them in place.
CREATE TABLE vetchium.org_conversations (
    conversation_id uuid PRIMARY KEY,
    contact_id uuid NOT NULL UNIQUE,
    org_did uuid NOT NULL,
    hub_user_did uuid NOT NULL,
    recorded_hub_user_name text NOT NULL,
    recorded_hub_user_handle text NOT NULL,
    recorded_agency_name text NOT NULL,
    recorded_agency_domain text NOT NULL,
    -- Hub user messages the agency has not read; any agency user's read
    -- clears it (MKT-DAT-010).
    agency_unread_count integer NOT NULL DEFAULT 0
        CHECK (agency_unread_count >= 0),
    read_only_reason text CHECK (
        read_only_reason IS NULL OR read_only_reason IN (
            'messages_off', 'hub_user_deleted', 'agency_deleted'
        )
    ),
    party_deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_activity_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_conversations_activity_check CHECK (
        last_activity_at >= created_at
    )
);
CREATE UNIQUE INDEX org_conversations_agency_user_key
    ON vetchium.org_conversations (org_did, hub_user_did);
CREATE INDEX org_conversations_list_idx
    ON vetchium.org_conversations (org_did, last_activity_at DESC, conversation_id DESC);
CREATE INDEX org_conversations_retention_idx
    ON vetchium.org_conversations (last_activity_at, conversation_id);
CREATE INDEX org_conversations_party_deleted_retention_idx
    ON vetchium.org_conversations (party_deleted_at, conversation_id)
    WHERE party_deleted_at IS NOT NULL;

-- Messages within a conversation (MKT-CNV-005).
CREATE TABLE vetchium.org_conversation_messages (
    message_id uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES vetchium.org_conversations (conversation_id)
        ON DELETE CASCADE,
    sender_type text NOT NULL CHECK (sender_type IN ('agency', 'hub_user')),
    sender_user_id uuid REFERENCES vetchium.org_users (org_user_id)
        ON DELETE SET NULL,
    sender_display_name text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('text', 'suggestion')),
    message_text text,
    consumer_domain text,
    opening_number integer CHECK (opening_number IS NULL OR opening_number >= 1),
    sent_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_conversation_messages_content_check CHECK (
        (kind = 'text' AND message_text IS NOT NULL
            AND message_text = btrim(message_text)
            AND char_length(message_text) BETWEEN 1 AND 5000
            AND consumer_domain IS NULL AND opening_number IS NULL)
        OR
        (kind = 'suggestion' AND message_text IS NULL
            AND consumer_domain IS NOT NULL AND opening_number IS NOT NULL
            AND sender_type = 'agency')
    )
);
CREATE INDEX org_conversation_messages_list_idx
    ON vetchium.org_conversation_messages (conversation_id, sent_at ASC, message_id ASC);
CREATE INDEX org_conversation_messages_retention_idx
    ON vetchium.org_conversation_messages (sent_at, message_id);

-- New conversations started per agency per UTC day (MKT-CNV-003).
CREATE TABLE vetchium.org_conversation_creations (
    org_did uuid NOT NULL REFERENCES vetchium.orgs (org_did)
        ON DELETE CASCADE,
    created_on date NOT NULL,
    created integer NOT NULL CHECK (created >= 1),
    PRIMARY KEY (org_did, created_on)
);

-- The Hub user's tenant keeps one pointer per agency Contact (MKT-DAT-003).
-- It holds conversation metadata when one exists, but never message or note text.
CREATE TABLE vetchium.hub_agency_pointers (
    contact_id uuid PRIMARY KEY,
    hub_user_did uuid NOT NULL REFERENCES vetchium.hub_users (hub_user_did)
        ON DELETE CASCADE,
    agency_org_did uuid NOT NULL,
    agency_display_name text NOT NULL DEFAULT '',
    agency_domain text NOT NULL DEFAULT '',
    has_conversation boolean NOT NULL DEFAULT false,
    last_activity_at timestamptz NOT NULL DEFAULT now(),
    unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
    read_only_reason text CHECK (
        read_only_reason IS NULL OR read_only_reason IN (
            'messages_off', 'hub_user_deleted', 'agency_deleted'
        )
    ),
    suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
    pointer_version integer NOT NULL DEFAULT 1 CHECK (pointer_version >= 1),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hub_agency_pointers_user_idx
    ON vetchium.hub_agency_pointers (hub_user_did, contact_id);
CREATE INDEX hub_agency_pointers_list_idx
    ON vetchium.hub_agency_pointers (hub_user_did, last_activity_at DESC, contact_id DESC)
    WHERE has_conversation = true;

-- Notifications sent to the Hub user when an agency sends a new message (MKT-CNV-008).
-- One row per notification, written beside the pointer and turned into an outbox
-- email by the workers. It names the agency and never message content.
CREATE TABLE vetchium.hub_message_notices (
    notice_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    hub_user_did uuid NOT NULL REFERENCES vetchium.hub_users (hub_user_did)
        ON DELETE CASCADE,
    agency_display_name text NOT NULL CHECK (length(btrim(agency_display_name)) > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hub_message_notices_queue_idx
    ON vetchium.hub_message_notices (created_at, notice_id);

-- Billable facts derived from recording actions (MKT-STM-001).
-- Authoritative on consumer tenant; outlives applicant retention with numbers only
-- (MKT-STM-004), deleted three years after engagement becomes terminal.
CREATE TABLE vetchium.org_activity_facts (
    fact_id uuid PRIMARY KEY,
    org_did uuid NOT NULL REFERENCES vetchium.orgs (org_did) ON DELETE CASCADE,
    engagement_id uuid NOT NULL REFERENCES vetchium.org_engagements (engagement_id) ON DELETE CASCADE,
    org_application_id uuid NOT NULL REFERENCES vetchium.org_applications (org_application_id) ON DELETE CASCADE,
    fact_date date NOT NULL,
    fact_kind text NOT NULL CHECK (
        fact_kind IN (
            'joined',
            'separated',
            'interview_completed',
            'interview_no_show',
            'assessment_result',
            'background_check_outcome'
        )
    ),
    reference_id text NOT NULL DEFAULT '',
    opening_number integer NOT NULL CHECK (opening_number >= 1),
    opening_title text NOT NULL,
    application_number integer NOT NULL CHECK (application_number >= 1),
    applicant_display_name text NOT NULL DEFAULT '',
    corrected boolean NOT NULL DEFAULT false,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_activity_facts_unique UNIQUE (
        engagement_id, org_application_id, fact_kind, reference_id
    )
);
CREATE INDEX org_activity_facts_statement_idx
    ON vetchium.org_activity_facts (engagement_id, fact_date ASC, fact_id ASC);
CREATE INDEX org_activity_facts_application_idx
    ON vetchium.org_activity_facts (org_application_id);

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

-- Every application transaction that changes a row also writes an audit
-- event. Inserting an audit event marks the transaction; a deferred trigger
-- on every other table checks the mark at commit and refuses the commit
-- without it. Sessions of the table owner (migrations, fixtures, operators)
-- are not application writes. Exempt: idempotency_ledger and
-- federation_command_ledger, the replay ledgers, which record responses
-- rather than changes.
-- +goose StatementBegin
CREATE FUNCTION vetchium.mark_transaction_audited()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_catalog.set_config('vetchium.audited', 'on', true);
    RETURN NULL;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION vetchium.require_audit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF pg_catalog.current_setting('vetchium.audited', true) = 'on'
        OR TG_TABLE_NAME IN ('idempotency_ledger', 'federation_command_ledger') THEN
        RETURN NULL;
    END IF;
    IF pg_catalog.pg_has_role(
        current_user,
        (SELECT c.relowner FROM pg_catalog.pg_class AS c WHERE c.oid = TG_RELID),
        'MEMBER'
    ) THEN
        RETURN NULL;
    END IF;
    RAISE EXCEPTION 'transaction changed %.% without an audit event',
        TG_TABLE_SCHEMA, TG_TABLE_NAME
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER audit_marks_transaction
AFTER INSERT ON vetchium.audit_events
FOR EACH ROW EXECUTE FUNCTION vetchium.mark_transaction_audited();

-- Audit events are append-only for the application.
REVOKE UPDATE, DELETE, TRUNCATE ON vetchium.audit_events FROM vetchium_app;

-- +goose StatementBegin
DO $$
DECLARE
    audited regclass;
BEGIN
    FOR audited IN
        SELECT c.oid::regclass
        FROM pg_catalog.pg_class AS c
        WHERE c.relnamespace = 'vetchium'::regnamespace
          AND c.relkind = 'r'
          AND c.relname <> 'audit_events'
    LOOP
        EXECUTE pg_catalog.format(
            'CREATE CONSTRAINT TRIGGER audit_required '
            'AFTER INSERT OR UPDATE OR DELETE ON %s '
            'DEFERRABLE INITIALLY DEFERRED '
            'FOR EACH ROW EXECUTE FUNCTION vetchium.require_audit()',
            audited
        );
    END LOOP;
END;
$$;
-- +goose StatementEnd

-- +goose Down
DROP TABLE IF EXISTS vetchium.hub_message_notices;
DROP TABLE IF EXISTS vetchium.hub_agency_pointers;
DROP TABLE IF EXISTS vetchium.org_conversation_creations;
DROP TABLE IF EXISTS vetchium.org_conversation_messages;
DROP TABLE IF EXISTS vetchium.org_conversations;
DROP TABLE IF EXISTS vetchium.org_contact_creations;
DROP TABLE IF EXISTS vetchium.org_contact_notes;
DROP TABLE IF EXISTS vetchium.org_contacts;
DROP TABLE IF EXISTS vetchium.hub_application_notices;
DROP TABLE IF EXISTS vetchium.hub_application_projections;
DROP FUNCTION IF EXISTS vetchium.org_user_acts_on_applications(uuid, uuid);
DROP FUNCTION IF EXISTS vetchium.hub_application_status(
    vetchium.org_application_state, vetchium.pipeline_stage_kind
);
DROP FUNCTION IF EXISTS vetchium.cancel_upcoming_interviews(uuid[]);
DROP FUNCTION IF EXISTS vetchium.end_pending_consents(uuid[]);
DROP FUNCTION IF EXISTS vetchium.provider_work_status(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS vetchium.end_provider_access(uuid[]);
DROP FUNCTION IF EXISTS vetchium.org_user_reads_applications(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS vetchium.org_user_reads_all_applications(uuid, uuid);
DROP TABLE IF EXISTS vetchium.org_background_check_results;
DROP TABLE IF EXISTS vetchium.org_background_checks;
DROP TYPE IF EXISTS vetchium.org_check_outcome;
DROP TYPE IF EXISTS vetchium.org_consent_state;
DROP TABLE IF EXISTS vetchium.org_application_assessments;
DROP TYPE IF EXISTS vetchium.org_assessment_outcome;
DROP TABLE IF EXISTS vetchium.org_provider_interview_feedback;
DROP TABLE IF EXISTS vetchium.org_provider_interview_interviewers;
DROP TABLE IF EXISTS vetchium.org_interview_feedback;
DROP TABLE IF EXISTS vetchium.org_interview_interviewers;
DROP TABLE IF EXISTS vetchium.org_interviews;
DROP TYPE IF EXISTS vetchium.org_interview_recommendation;
DROP TYPE IF EXISTS vetchium.org_interview_response;
DROP TYPE IF EXISTS vetchium.org_interview_state;
DROP TYPE IF EXISTS vetchium.org_interview_mode;
DROP TABLE IF EXISTS vetchium.org_application_offers;
DROP TYPE IF EXISTS vetchium.org_application_offer_status;
DROP TABLE IF EXISTS vetchium.org_offer_letter_objects;
DROP TYPE IF EXISTS vetchium.org_offer_letter_state;
DROP TABLE IF EXISTS vetchium.org_activity_facts;
DROP TABLE IF EXISTS vetchium.org_application_routes;
DROP TABLE IF EXISTS vetchium.org_engagement_assignments;
DROP TABLE IF EXISTS vetchium.org_application_history;
DROP TABLE IF EXISTS vetchium.org_application_stages;
DROP TABLE IF EXISTS vetchium.org_applications;
DROP TABLE IF EXISTS vetchium.org_applicants;
DROP TYPE IF EXISTS vetchium.org_application_actor_kind;
DROP TYPE IF EXISTS vetchium.org_application_history_action;
DROP TYPE IF EXISTS vetchium.org_application_stage_status;
DROP TYPE IF EXISTS vetchium.org_application_state;
DROP TYPE IF EXISTS vetchium.org_applicant_kind;
DROP TABLE IF EXISTS vetchium.org_opening_stages;
DROP TABLE IF EXISTS vetchium.org_pipeline_template_stages;
DROP TABLE IF EXISTS vetchium.org_pipeline_templates;
DROP TABLE IF EXISTS vetchium.org_job_owners;
DROP TABLE IF EXISTS vetchium.org_engagement_projections;
DROP VIEW IF EXISTS vetchium.org_engagement_snapshots;
DROP TABLE IF EXISTS vetchium.org_engagements;
DROP TYPE IF EXISTS vetchium.org_engagement_party;
DROP TYPE IF EXISTS vetchium.org_engagement_state;
DROP TABLE IF EXISTS vetchium.org_listings;
DROP TYPE IF EXISTS vetchium.org_listing_state;
DROP TABLE IF EXISTS vetchium.capabilities;
DROP TYPE IF EXISTS vetchium.pipeline_stage_kind;
DROP TABLE IF EXISTS vetchium.idempotency_ledger;
DROP TABLE IF EXISTS vetchium.org_ai_usage_texts;
DROP TABLE IF EXISTS vetchium.org_ai_usage;
DROP TYPE IF EXISTS vetchium.org_ai_failure_reason;
DROP TYPE IF EXISTS vetchium.org_ai_usage_state;
DROP TABLE IF EXISTS vetchium.org_ai_credit_lots;
DROP TYPE IF EXISTS vetchium.org_ai_credit_lot_kind;
DROP TABLE IF EXISTS vetchium.org_ai_operation_policies;
DROP TABLE IF EXISTS vetchium.org_ai_settings;
DROP TABLE IF EXISTS vetchium.org_opening_history;
DROP TABLE IF EXISTS vetchium.org_opening_requests;
DROP TABLE IF EXISTS vetchium.org_opening_team_members;
DROP TABLE IF EXISTS vetchium.org_opening_contents;
DROP TABLE IF EXISTS vetchium.org_openings;
DROP TYPE IF EXISTS vetchium.org_opening_history_action;
DROP TYPE IF EXISTS vetchium.org_opening_request_state;
DROP TYPE IF EXISTS vetchium.org_opening_request_kind;
DROP TYPE IF EXISTS vetchium.org_opening_content_slot;
DROP TYPE IF EXISTS vetchium.org_opening_salary_period;
DROP TYPE IF EXISTS vetchium.org_opening_education;
DROP TYPE IF EXISTS vetchium.org_opening_employment_type;
DROP TYPE IF EXISTS vetchium.org_opening_remote_eligibility;
DROP TYPE IF EXISTS vetchium.org_opening_work_arrangement;
DROP TYPE IF EXISTS vetchium.org_opening_state;
DROP TABLE IF EXISTS vetchium.org_email_outbox;
DROP TABLE IF EXISTS vetchium.org_signup_completions;
DROP TYPE IF EXISTS vetchium.org_signup_completion_state;
DROP TABLE IF EXISTS vetchium.org_signup_requests;
DROP TABLE IF EXISTS vetchium.org_signup_blocked_domains;
DROP TABLE IF EXISTS vetchium.org_password_reset_tokens;
DROP TABLE IF EXISTS vetchium.org_totp_recovery_codes;
DROP TABLE IF EXISTS vetchium.org_totp_enrollments;
DROP TABLE IF EXISTS vetchium.org_login_challenges;
DROP TABLE IF EXISTS vetchium.org_logo_objects;
DROP TYPE IF EXISTS vetchium.org_logo_state;
DROP TYPE IF EXISTS vetchium.org_logo_format;
DROP FUNCTION IF EXISTS vetchium.org_seats_in_use(uuid);
DROP TABLE IF EXISTS vetchium.org_user_invitations;
DROP TABLE IF EXISTS vetchium.org_sso_login_states;
DROP TABLE IF EXISTS vetchium.org_user_sso_identities;
DROP TABLE IF EXISTS vetchium.org_sessions;
DROP VIEW IF EXISTS vetchium.org_effective_permissions;
DROP TABLE IF EXISTS vetchium.org_user_permissions;
DROP TABLE IF EXISTS vetchium.org_permission_implications;
DROP TABLE IF EXISTS vetchium.org_permission_catalog;
DROP TABLE IF EXISTS vetchium.org_user_totp_credentials;
DROP TABLE IF EXISTS vetchium.org_user_passwords;
DROP TABLE IF EXISTS vetchium.org_terms_acceptances;
DROP TABLE IF EXISTS vetchium.org_users;
DROP TYPE IF EXISTS vetchium.org_user_state;
DROP TABLE IF EXISTS vetchium.org_domains;
DROP TYPE IF EXISTS vetchium.org_domain_state;
DROP TABLE IF EXISTS vetchium.orgs;
DROP TYPE IF EXISTS vetchium.org_state;
DROP TYPE IF EXISTS vetchium.org_billing_interval;
DROP TABLE IF EXISTS vetchium.org_plans;
DROP TABLE IF EXISTS vetchium.federation_event_watermarks;
DROP TABLE IF EXISTS vetchium.federation_inbox;
DROP TABLE IF EXISTS vetchium.federation_outbox;
DROP TABLE IF EXISTS vetchium.federation_command_ledger;
DROP TABLE IF EXISTS vetchium.hub_account_email_changes;
DROP TYPE IF EXISTS vetchium.hub_account_email_change_state;
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
DROP TABLE IF EXISTS vetchium.hub_email_change_challenges;
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
DROP DOMAIN IF EXISTS vetchium.org_domain;
DROP DOMAIN IF EXISTS vetchium.org_frontend_locale;
DROP DOMAIN IF EXISTS vetchium.admin_frontend_locale;
DROP DOMAIN IF EXISTS vetchium.hub_frontend_locale;
DROP DOMAIN IF EXISTS vetchium.profile_domain;
DROP FUNCTION IF EXISTS vetchium.enforce_hub_profile_entry_limit();
DROP FUNCTION IF EXISTS vetchium.array_is_distinct(text[]);
DROP FUNCTION IF EXISTS vetchium.require_audit();
DROP FUNCTION IF EXISTS vetchium.mark_transaction_audited();
