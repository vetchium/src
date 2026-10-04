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
        (kind = 'handle' AND slug ~ '^[a-z0-9]{8}-[0-9a-hjkmnp-tv-z]{11}$')
        OR (kind = 'alias'
            AND slug ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
            AND length(slug) BETWEEN 3 AND 30
            AND slug !~ '^[a-z0-9]{8}-[0-9a-hjkmnp-tv-z]{11}$'
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

CREATE TABLE vetchium.org_principals (
    org_did uuid PRIMARY KEY,
    home_tenant_id text NOT NULL,
    state vetchium.global_principal_state NOT NULL,
    routing_version bigint NOT NULL DEFAULT 1,
    directory_version bigint NOT NULL DEFAULT 1,
    provisioning_operation_id uuid NOT NULL UNIQUE,
    provisioning_expires_at timestamptz,
    activated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_principals_did_uuidv7_check CHECK (
        substring(org_did::text FROM 15 FOR 1) = '7'
    ),
    CONSTRAINT org_principals_home_tenant_check CHECK (
        home_tenant_id ~ '^[a-z][a-z0-9]{2,15}$'
    ),
    CONSTRAINT org_principals_routing_version_check CHECK (
        routing_version > 0
    ),
    CONSTRAINT org_principals_directory_version_check CHECK (
        directory_version > 0
    ),
    CONSTRAINT org_principals_state_check CHECK (
        (state = 'provisioning'
            AND provisioning_expires_at IS NOT NULL
            AND provisioning_expires_at > created_at
            AND activated_at IS NULL)
        OR (state = 'active'
            AND provisioning_expires_at IS NULL
            AND activated_at IS NOT NULL
            AND activated_at >= created_at)
    ),
    CONSTRAINT org_principals_timestamps_check CHECK (
        updated_at >= created_at
    )
);

-- Exact domains, so eu.example.com and example.com are independent claims.
-- A row exists only while its Org owns the domain; releasing deletes it and
-- the domain becomes claimable again.
CREATE TABLE vetchium.org_domains (
    domain text PRIMARY KEY,
    org_did uuid NOT NULL REFERENCES vetchium.org_principals (org_did),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT org_domains_domain_check CHECK (
        domain = lower(btrim(domain)) AND
        char_length(domain) BETWEEN 3 AND 253 AND
        domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' AND
        domain ~ '\.[a-z0-9-]*[a-z][a-z0-9-]*$'
    )
);

-- An Org has exactly one domain in this version. Allowing several later means
-- dropping this constraint and adding a primary-domain marker.
CREATE UNIQUE INDEX org_domains_one_per_org_idx
    ON vetchium.org_domains (org_did);

-- +goose StatementBegin
CREATE FUNCTION vetchium.enforce_org_principal_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.org_did <> OLD.org_did OR
       NEW.provisioning_operation_id <> OLD.provisioning_operation_id OR
       NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'immutable global Org principal identity changed';
    END IF;
    IF OLD.state = 'active' AND NEW.state <> 'active' THEN
        RAISE EXCEPTION 'an active Org principal cannot return to provisioning';
    END IF;
    IF NEW.home_tenant_id IS DISTINCT FROM OLD.home_tenant_id THEN
        IF OLD.state <> 'active' OR NEW.state <> 'active' OR
           NEW.routing_version <> OLD.routing_version + 1 THEN
            RAISE EXCEPTION 'tenant handover must increment the active route version once';
        END IF;
    ELSIF NEW.routing_version <> OLD.routing_version THEN
        RAISE EXCEPTION 'route version changed without a tenant handover';
    END IF;
    IF NEW.directory_version < OLD.directory_version THEN
        RAISE EXCEPTION 'directory version must not decrease';
    END IF;
    RETURN NEW;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER org_principals_enforce_transition
BEFORE UPDATE ON vetchium.org_principals
FOR EACH ROW EXECUTE FUNCTION vetchium.enforce_org_principal_transition();

CREATE TYPE vetchium.global_account_email_claim_state AS ENUM (
    'provisioning', 'active', 'pending_change'
);

CREATE TYPE vetchium.global_email_change_reservation_state AS ENUM (
    'reserved', 'cancelled', 'finalized'
);

-- An email-change reservation is created before its pending_change claim, so
-- the claim's change_id foreign key can reference it directly. A cancelled
-- reservation stays as a tombstone (see the digest CHECK below), so a
-- delayed reserve for the same change_id can never resurrect it.
CREATE TABLE vetchium.hub_account_email_change_reservations (
    change_id uuid PRIMARY KEY,
    hub_user_did uuid NOT NULL
        REFERENCES vetchium.hub_principals (hub_user_did) ON DELETE CASCADE,
    -- NULL only on a tombstone written by an abandon that arrived before its
    -- reserve: the change id alone fences it.
    email_digest bytea CHECK (octet_length(email_digest) = 32),
    state vetchium.global_email_change_reservation_state NOT NULL,
    not_after timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT hub_account_email_change_reservations_digest_check CHECK (
        state = 'cancelled' OR email_digest IS NOT NULL
    ),
    CONSTRAINT hub_account_email_change_reservations_timestamps_check CHECK (
        updated_at >= created_at
    )
);

CREATE TABLE vetchium.hub_account_email_claims (
    email_digest bytea PRIMARY KEY CHECK (octet_length(email_digest) = 32),
    hub_user_did uuid NOT NULL
        REFERENCES vetchium.hub_principals (hub_user_did) ON DELETE CASCADE,
    state vetchium.global_account_email_claim_state NOT NULL,
    command_id uuid NOT NULL,
    change_id uuid
        REFERENCES vetchium.hub_account_email_change_reservations (change_id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (updated_at >= created_at),
    CHECK ((state = 'pending_change') = (change_id IS NOT NULL))
);
CREATE UNIQUE INDEX hub_account_email_claims_one_current
    ON vetchium.hub_account_email_claims (hub_user_did)
    WHERE state IN ('provisioning', 'active');
CREATE UNIQUE INDEX hub_account_email_claims_one_pending_change
    ON vetchium.hub_account_email_claims (hub_user_did)
    WHERE state = 'pending_change';

-- +goose StatementBegin
CREATE FUNCTION vetchium.enforce_account_email_claim_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    principal_active boolean;
    other_current_exists boolean;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    IF NEW.hub_user_did <> OLD.hub_user_did OR
       NEW.email_digest <> OLD.email_digest THEN
        RAISE EXCEPTION 'immutable global account email claim identity changed';
    END IF;
    IF OLD.state = NEW.state THEN
        RETURN NEW;
    END IF;
    IF OLD.state = 'provisioning' AND NEW.state = 'active' THEN
        SELECT (state = 'active') INTO principal_active
        FROM vetchium.hub_principals
        WHERE hub_user_did = NEW.hub_user_did;
        IF NOT COALESCE(principal_active, false) THEN
            RAISE EXCEPTION 'account email claim cannot activate before its principal';
        END IF;
        RETURN NEW;
    END IF;
    -- finalize deletes the user's old active claim before promoting the
    -- pending_change claim in the same statement, so by the time this fires
    -- no other current claim should remain.
    IF OLD.state = 'pending_change' AND NEW.state = 'active' THEN
        SELECT EXISTS (
            SELECT 1 FROM vetchium.hub_account_email_claims
            WHERE hub_user_did = NEW.hub_user_did
              AND state IN ('active', 'provisioning')
        ) INTO other_current_exists;
        IF other_current_exists THEN
            RAISE EXCEPTION 'another current account email claim still exists for this user';
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'disallowed account email claim state transition from % to %', OLD.state, NEW.state;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER hub_account_email_claims_enforce_transition
BEFORE UPDATE OR DELETE ON vetchium.hub_account_email_claims
FOR EACH ROW EXECUTE FUNCTION vetchium.enforce_account_email_claim_transition();

-- +goose StatementBegin
CREATE FUNCTION vetchium.enforce_email_change_reservation_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.change_id <> OLD.change_id OR
       NEW.hub_user_did <> OLD.hub_user_did OR
       NEW.email_digest IS DISTINCT FROM OLD.email_digest OR
       NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'immutable global email change reservation identity changed';
    END IF;
    IF OLD.state = NEW.state THEN
        RETURN NEW;
    END IF;
    IF OLD.state = 'reserved' AND NEW.state IN ('cancelled', 'finalized') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'disallowed email change reservation state transition from % to %', OLD.state, NEW.state;
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER hub_account_email_change_reservations_enforce_transition
BEFORE UPDATE ON vetchium.hub_account_email_change_reservations
FOR EACH ROW EXECUTE FUNCTION vetchium.enforce_email_change_reservation_transition();

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

-- Every application transaction that changes a row also writes an audit
-- event. Inserting an audit event marks the transaction; a deferred trigger
-- on every other table checks the mark at commit and refuses the commit
-- without it. Sessions of the table owner (migrations, fixtures, operators)
-- are not application writes. Exempt: global_command_ledger, the replay
-- ledger, which records responses rather than changes.
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
        OR TG_TABLE_NAME = 'global_command_ledger' THEN
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
AFTER INSERT ON vetchium.global_audit_events
FOR EACH ROW EXECUTE FUNCTION vetchium.mark_transaction_audited();

-- Audit events are append-only for the application.
REVOKE UPDATE, DELETE, TRUNCATE ON vetchium.global_audit_events FROM vetchium_app;

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
          AND c.relname <> 'global_audit_events'
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
DROP TABLE IF EXISTS vetchium.global_outbox_events;
DROP TABLE IF EXISTS vetchium.global_command_ledger;
DROP TABLE IF EXISTS vetchium.global_audit_events;
DROP TRIGGER IF EXISTS hub_account_email_change_reservations_enforce_transition
    ON vetchium.hub_account_email_change_reservations;
DROP FUNCTION IF EXISTS vetchium.enforce_email_change_reservation_transition();
DROP TRIGGER IF EXISTS hub_account_email_claims_enforce_transition
    ON vetchium.hub_account_email_claims;
DROP FUNCTION IF EXISTS vetchium.enforce_account_email_claim_transition();
DROP TABLE IF EXISTS vetchium.hub_account_email_claims;
DROP TABLE IF EXISTS vetchium.hub_account_email_change_reservations;
DROP TYPE IF EXISTS vetchium.global_email_change_reservation_state;
DROP TYPE IF EXISTS vetchium.global_account_email_claim_state;
DROP TABLE IF EXISTS vetchium.hub_profile_slugs;
DROP TABLE IF EXISTS vetchium.org_domains;
DROP TABLE IF EXISTS vetchium.org_principals;
DROP FUNCTION IF EXISTS vetchium.enforce_org_principal_transition();
DROP FUNCTION IF EXISTS vetchium.protect_permanent_handle();
DROP TABLE IF EXISTS vetchium.hub_principals;
DROP FUNCTION IF EXISTS vetchium.enforce_principal_transition();
DROP TYPE IF EXISTS vetchium.global_profile_slug_kind;
DROP TYPE IF EXISTS vetchium.global_principal_state;
DROP FUNCTION IF EXISTS vetchium.require_audit();
DROP FUNCTION IF EXISTS vetchium.mark_transaction_audited();
