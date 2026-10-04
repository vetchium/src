#!/bin/sh
# Applies each migration set to a scratch PostgreSQL bootstrapped like the
# real ones, rolls it all the way back, requires the schema to be empty, and
# applies it again. Usage: db/check-migrations.sh <postgres-image>
set -eu

postgres_image=${1:?postgres image required}
root=$(cd "$(dirname "$0")/.." && pwd)
run_id="vetchium-migration-check-$$"
network="$run_id"
password_file=$(mktemp)
containers=""

cleanup() {
    for container in $containers; do
        docker rm -f "$container" >/dev/null 2>&1 || true
    done
    docker network rm "$network" >/dev/null 2>&1 || true
    rm -f "$password_file"
}
trap cleanup EXIT INT TERM

printf '%s' check-app-password > "$password_file"
chmod 644 "$password_file"
docker network create "$network" >/dev/null

check() {
    set_name=$1
    database="$run_id-$set_name"
    containers="$containers $database"
    image=$(docker build -q "$root/db/$set_name")
    docker run -d --name "$database" --network "$network" \
        -e POSTGRES_USER=check -e POSTGRES_PASSWORD=check \
        -e POSTGRES_DB=check \
        -e APP_POSTGRES_PASSWORD_FILE=/run/app_postgres_password \
        -v "$password_file:/run/app_postgres_password:ro" \
        -v "$root/db/bootstrap/entrypoint.sh:/usr/local/bin/vetchium-entrypoint.sh:ro" \
        -v "$root/db/bootstrap/init.sql:/docker-entrypoint-initdb.d/10-vetchium.sql:ro" \
        --entrypoint /bin/sh "$postgres_image" \
        /usr/local/bin/vetchium-entrypoint.sh postgres >/dev/null

    # The init scripts run against a socket-only server; TCP readiness means
    # bootstrap finished.
    attempts=0
    until docker exec "$database" \
        pg_isready -q -h 127.0.0.1 -U check -d check 2>/dev/null; do
        attempts=$((attempts + 1))
        if [ "$attempts" -ge 60 ]; then
            echo "$set_name: PostgreSQL did not become ready" >&2
            docker logs "$database" >&2
            exit 1
        fi
        sleep 1
    done

    goose() {
        docker run --rm --network "$network" \
            -e "GOOSE_DBSTRING=postgres://check:check@$database:5432/check?sslmode=disable" \
            "$image" "$@" >/dev/null
    }

    echo "==> $set_name: up"
    goose up
    echo "==> $set_name: reset"
    goose reset
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
    goose up
}

check migrations
check global-migrations
