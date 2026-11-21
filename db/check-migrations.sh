#!/bin/sh
# Applies each migration set to a scratch PostgreSQL bootstrapped like the
# real ones, rolls it all the way back, requires the schema to be empty, and
# applies it again. Then it requires the audit trigger on every table and
# exercises it and the read-only Opening tag catalog as the application role.
# Usage: db/check-migrations.sh <postgres-image>
set -eu

postgres_image=${1:?postgres image required}
root=$(cd "$(dirname "$0")/.." && pwd)
run_id="vetchium-migration-check-$$"
. "$root/db/scratch-postgres.sh"
scratch_setup

check() {
    set_name=$1
    database="$run_id-$set_name"
    scratch_start "$database"

    echo "==> $set_name: up"
    scratch_goose "$database" "$set_name" up
    echo "==> $set_name: reset"
    scratch_goose "$database" "$set_name" reset
    leftovers=$(docker exec "$database" psql -U check -d check -tA -c "
        SELECT 'relation ' || relname FROM pg_class
        WHERE relnamespace = 'vetchium'::regnamespace
        UNION ALL
        SELECT 'type ' || typname FROM pg_type
        WHERE typnamespace = 'vetchium'::regnamespace
        UNION ALL
        SELECT 'function ' || proname FROM pg_proc
        WHERE pronamespace = 'vetchium'::regnamespace
        ORDER BY 1;")
    if [ -n "$leftovers" ]; then
        echo "$set_name: the down migration left objects behind:" >&2
        echo "$leftovers" >&2
        exit 1
    fi
    echo "==> $set_name: up again"
    scratch_goose "$database" "$set_name" up

    unguarded=$(docker exec "$database" psql -U check -d check -tA -c "
        SELECT c.relname FROM pg_class AS c
        WHERE c.relnamespace = 'vetchium'::regnamespace
          AND c.relkind = 'r'
          AND NOT EXISTS (
              SELECT 1 FROM pg_trigger AS t
              WHERE t.tgrelid = c.oid AND t.tgname IN (
                  'audit_required', 'audit_marks_transaction'
              )
          )
        ORDER BY 1;")
    if [ -n "$unguarded" ]; then
        echo "$set_name: tables without the audit_required trigger:" >&2
        echo "$unguarded" >&2
        exit 1
    fi
}

# Runs SQL as the application role, which the audit triggers govern.
as_app() {
    docker exec -i -e PGPASSWORD=check-app-password "$1" \
        psql -h 127.0.0.1 -U vetchium_app -d check -v ON_ERROR_STOP=1 -qtA
}

expect_accepted() {
    if ! output=$(as_app "$1" 2>&1); then
        echo "app role check: $2 was refused: $output" >&2
        exit 1
    fi
}

expect_refused() {
    if output=$(as_app "$1" 2>&1); then
        echo "app role check: $2 was accepted" >&2
        exit 1
    fi
    case "$output" in
    *"without an audit event"*) ;;
    *)
        echo "app role check: $2 failed for another reason: $output" >&2
        exit 1
        ;;
    esac
}

expect_denied() {
    if output=$(as_app "$1" 2>&1); then
        echo "app role check: $2 was accepted" >&2
        exit 1
    fi
    case "$output" in
    *"permission denied"*) ;;
    *)
        echo "app role check: $2 failed for another reason: $output" >&2
        exit 1
        ;;
    esac
}

check_tenant_audit() {
    database="$run_id-migrations"
    echo "==> migrations: audit enforcement"
    expect_refused "$database" "an unaudited write" <<'SQL'
INSERT INTO vetchium.hub_signup_domains (domain) VALUES ('unaudited.example');
SQL
    expect_refused "$database" "an audit event rolled back to a savepoint" <<'SQL'
BEGIN;
INSERT INTO vetchium.hub_signup_domains (domain) VALUES ('savepoint.example');
SAVEPOINT audit;
INSERT INTO vetchium.audit_events (
    tenant_id, action, entity_type, entity_id, actor_type, source
) VALUES ('check', 'check', 'check', 'check', 'check', 'check');
ROLLBACK TO SAVEPOINT audit;
COMMIT;
SQL
    expect_accepted "$database" "an audited write" <<'SQL'
BEGIN;
INSERT INTO vetchium.hub_signup_domains (domain) VALUES ('audited.example');
INSERT INTO vetchium.audit_events (
    tenant_id, action, entity_type, entity_id, actor_type, source
) VALUES ('check', 'check', 'check', 'check', 'check', 'check');
COMMIT;
SQL
    expect_denied "$database" "deleting an audit event" <<'SQL'
DELETE FROM vetchium.audit_events;
SQL
    expect_denied "$database" "updating an audit event" <<'SQL'
UPDATE vetchium.audit_events SET action = 'rewritten';
SQL
    expect_accepted "$database" "a write that changed no rows" <<'SQL'
UPDATE vetchium.hub_signup_domains SET updated_at = now() WHERE false;
SQL
    expect_accepted "$database" "an idempotency ledger write" <<'SQL'
INSERT INTO vetchium.idempotency_ledger (
    operation, binding_id, idempotency_key, request_digest, expires_at
) VALUES (
    'check', 'check', 'check', sha256('check'), now() + interval '1 hour'
);
SQL
}

check_global_audit() {
    database="$run_id-global-migrations"
    echo "==> global-migrations: audit enforcement"
    expect_refused "$database" "an unaudited global write" <<'SQL'
INSERT INTO vetchium.global_outbox_events (
    aggregate_type, aggregate_id, aggregate_version, event_type, payload
) VALUES ('check', 'check', 1, 'check', '{}');
SQL
    expect_accepted "$database" "an audited global write" <<'SQL'
BEGIN;
INSERT INTO vetchium.global_outbox_events (
    aggregate_type, aggregate_id, aggregate_version, event_type, payload
) VALUES ('check', 'check', 1, 'check', '{}');
INSERT INTO vetchium.global_audit_events (
    action, entity_type, entity_id, actor_tenant_id
) VALUES ('check', 'check', 'check', 'sgp');
COMMIT;
SQL
    expect_denied "$database" "deleting a global audit event" <<'SQL'
DELETE FROM vetchium.global_audit_events;
SQL
}

# Migrations seed the Opening tag catalog; the application only reads it
# (OPN-TAG-001).
check_tenant_catalog() {
    database="$run_id-migrations"
    echo "==> migrations: read-only Opening tag catalog"
    expect_accepted "$database" "reading the Opening tag catalog" <<'SQL'
SELECT count(*) FROM vetchium.opening_tags
LEFT JOIN vetchium.opening_tag_names USING (tag_oid);
SQL
    for table in opening_tags opening_tag_names; do
        expect_denied "$database" "inserting into $table" <<SQL
INSERT INTO vetchium.$table SELECT * FROM vetchium.$table LIMIT 0;
SQL
        expect_denied "$database" "updating $table" <<SQL
UPDATE vetchium.$table SET display_name = display_name WHERE false;
SQL
        expect_denied "$database" "deleting from $table" <<SQL
DELETE FROM vetchium.$table WHERE false;
SQL
        expect_denied "$database" "truncating $table" <<SQL
TRUNCATE vetchium.$table;
SQL
    done
}

check migrations
check global-migrations
check_tenant_audit
check_tenant_catalog
check_global_audit
