-- +goose Up

CREATE SCHEMA IF NOT EXISTS vetchium;

CREATE TYPE vetchium.global_principal_state AS ENUM (
    'provisioning',
    'active'
);

CREATE TYPE vetchium.global_profile_slug_kind AS ENUM (
    'handle',
    'alias'
);

CREATE TABLE vetchium.hub_principals (
    hub_user_did uuid PRIMARY KEY,
    home_tenant_id text NOT NULL,
    state vetchium.global_principal_state NOT NULL,
    routing_version bigint NOT NULL DEFAULT 1,
    directory_version bigint NOT NULL DEFAULT 1,
    alias_revision bigint NOT NULL DEFAULT 0 CHECK (alias_revision >= 0),
    provisioning_operation_id uuid NOT NULL UNIQUE,
    provisioning_expires_at timestamptz,
    activated_at timestamptz,
    alias_changed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT hub_principals_did_uuidv7_check CHECK (
        substring(hub_user_did::text FROM 15 FOR 1) = '7'
    ),
    CONSTRAINT hub_principals_home_tenant_check CHECK (
        home_tenant_id ~ '^[a-z][a-z0-9]{2,15}$'
    ),
    CONSTRAINT hub_principals_routing_version_check CHECK (
        routing_version > 0
    ),
    CONSTRAINT hub_principals_directory_version_check CHECK (
        directory_version > 0
    ),
    CONSTRAINT hub_principals_state_check CHECK (
        (state = 'provisioning'
            AND provisioning_expires_at IS NOT NULL
            AND provisioning_expires_at > created_at
            AND activated_at IS NULL)
        OR (state = 'active'
            AND provisioning_expires_at IS NULL
            AND activated_at IS NOT NULL
            AND activated_at >= created_at)
    ),
    CONSTRAINT hub_principals_timestamps_check CHECK (
        updated_at >= created_at AND
        (alias_changed_at IS NULL OR alias_changed_at >= created_at)
    )
);

CREATE TABLE vetchium.hub_profile_slugs (
    slug text PRIMARY KEY,
    hub_user_did uuid NOT NULL REFERENCES vetchium.hub_principals (hub_user_did),
    kind vetchium.global_profile_slug_kind NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT hub_profile_slugs_one_kind_per_user UNIQUE (hub_user_did, kind),
    CONSTRAINT hub_profile_slugs_shape_check CHECK (
        (kind = 'handle' AND slug ~ '^[a-z0-9]{5}-[0-9a-hjkmnp-tv-z]{11}$')
        OR (kind = 'alias'
            AND slug ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
            AND length(slug) BETWEEN 3 AND 30
            AND slug !~ '^[a-z0-9]{5}-[0-9a-hjkmnp-tv-z]{11}$'
            AND slug <> ALL (ARRAY[
                'api', 'admin', 'auth', 'help', 'jobs', 'login', 'logout',
                'media', 'org', 'privacy', 'settings', 'signup', 'support',
                'terms', 'u'
            ]::text[]))
    )
);

-- A handle is a permanent tombstone as well as a route. Account lifecycle
-- changes retain the principal row and handle, so neither can be reassigned.
-- +goose StatementBegin
CREATE FUNCTION vetchium.protect_permanent_handle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    releasable_provisioning_handle boolean;
BEGIN
    releasable_provisioning_handle := false;
    IF TG_OP = 'DELETE' AND OLD.kind = 'handle' THEN
        SELECT EXISTS (
            SELECT 1
            FROM vetchium.hub_principals AS principal
            WHERE principal.hub_user_did = OLD.hub_user_did
              AND principal.state = 'provisioning'
              AND principal.provisioning_expires_at <= now()
        ) INTO releasable_provisioning_handle;
    END IF;
    IF (OLD.kind = 'handle' AND NOT releasable_provisioning_handle) OR
       (TG_OP = 'UPDATE' AND NEW.kind = 'handle') THEN
        RAISE EXCEPTION 'permanent Hub handles cannot be changed or deleted';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER hub_profile_slugs_protect_handle
BEFORE UPDATE OR DELETE ON vetchium.hub_profile_slugs
FOR EACH ROW EXECUTE FUNCTION vetchium.protect_permanent_handle();

-- +goose StatementBegin
CREATE FUNCTION vetchium.enforce_principal_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.hub_user_did <> OLD.hub_user_did OR
       NEW.provisioning_operation_id <> OLD.provisioning_operation_id OR
       NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'immutable global principal identity changed';
    END IF;
    IF NEW.alias_changed_at IS DISTINCT FROM OLD.alias_changed_at AND
       (NEW.alias_changed_at IS NULL OR
        (OLD.alias_changed_at IS NOT NULL AND
         NEW.alias_changed_at < OLD.alias_changed_at + interval '7 days')) THEN
        RAISE EXCEPTION 'alias changes must be at least seven days apart';
    END IF;
    IF NEW.alias_revision <> OLD.alias_revision AND
       NEW.alias_revision <> OLD.alias_revision + 1 THEN
        RAISE EXCEPTION 'alias revision must increase once per change';
    END IF;
    IF OLD.state = 'active' AND NEW.state <> 'active' THEN
        RAISE EXCEPTION 'an active global principal cannot return to provisioning';
    END IF;
    IF NEW.home_tenant_id IS DISTINCT FROM OLD.home_tenant_id THEN
        IF OLD.state <> 'active' OR NEW.state <> 'active' OR
           NEW.routing_version <> OLD.routing_version + 1 THEN
            RAISE EXCEPTION 'tenant handover must increment the active route version once';
        END IF;
    ELSIF NEW.routing_version <> OLD.routing_version THEN
        RAISE EXCEPTION 'route version changed without a tenant handover';
    END IF;
    IF NEW.state IS DISTINCT FROM OLD.state OR
       NEW.home_tenant_id IS DISTINCT FROM OLD.home_tenant_id OR
       NEW.alias_changed_at IS DISTINCT FROM OLD.alias_changed_at OR
       NEW.alias_revision IS DISTINCT FROM OLD.alias_revision THEN
        IF NEW.directory_version <> OLD.directory_version + 1 THEN
            RAISE EXCEPTION 'directory mutation must increment its version once';
        END IF;
    ELSIF NEW.directory_version <> OLD.directory_version THEN
        RAISE EXCEPTION 'directory version changed without a directory mutation';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER hub_principals_enforce_transition
BEFORE UPDATE ON vetchium.hub_principals
FOR EACH ROW EXECUTE FUNCTION vetchium.enforce_principal_transition();

CREATE TABLE vetchium.global_audit_events (
    global_audit_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    actor_tenant_id text NOT NULL,
    command_id uuid,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT global_audit_events_names_check CHECK (
        length(btrim(action)) > 0 AND
        length(btrim(entity_type)) > 0 AND
        length(btrim(entity_id)) > 0 AND
        actor_tenant_id ~ '^[a-z][a-z0-9]{2,15}$'
    )
);

CREATE TABLE vetchium.global_command_ledger (
    command_id uuid PRIMARY KEY,
    operation text NOT NULL,
    caller_tenant_id text NOT NULL,
    request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
    response_status integer NOT NULL CHECK (response_status BETWEEN 200 AND 499),
    response_body jsonb NOT NULL,
    completed_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT global_command_ledger_operation_check CHECK (
        length(btrim(operation)) > 0
    ),
    CONSTRAINT global_command_ledger_tenant_check CHECK (
        caller_tenant_id ~ '^[a-z][a-z0-9]{2,15}$'
    )
);

CREATE TABLE vetchium.global_outbox_events (
    global_outbox_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type text NOT NULL,
    aggregate_id text NOT NULL,
    aggregate_version bigint NOT NULL CHECK (aggregate_version > 0),
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    delivered_at timestamptz,
    CONSTRAINT global_outbox_events_names_check CHECK (
        length(btrim(aggregate_type)) > 0 AND
        length(btrim(aggregate_id)) > 0 AND
        length(btrim(event_type)) > 0
    ),
    CONSTRAINT global_outbox_events_delivery_check CHECK (
        delivered_at IS NULL OR delivered_at >= created_at
    )
);

-- +goose Down
DROP TABLE IF EXISTS vetchium.global_outbox_events;
DROP TABLE IF EXISTS vetchium.global_command_ledger;
DROP TABLE IF EXISTS vetchium.global_audit_events;
DROP TABLE IF EXISTS vetchium.hub_profile_slugs;
DROP FUNCTION IF EXISTS vetchium.protect_permanent_handle();
DROP TABLE IF EXISTS vetchium.hub_principals;
DROP FUNCTION IF EXISTS vetchium.enforce_principal_transition();
DROP TYPE IF EXISTS vetchium.global_profile_slug_kind;
DROP TYPE IF EXISTS vetchium.global_principal_state;
