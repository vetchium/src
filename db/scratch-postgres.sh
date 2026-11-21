# Scratch PostgreSQL servers bootstrapped like the real ones, for scripts that
# source this file. The caller sets postgres_image, root, and run_id, and calls
# scratch_setup once before starting any server.

scratch_setup() {
    network="$run_id"
    password_file=$(mktemp)
    containers=""
    trap scratch_cleanup EXIT INT TERM
    printf '%s' check-app-password > "$password_file"
    chmod 644 "$password_file"
    docker network create "$network" >/dev/null
}

scratch_cleanup() {
    for container in $containers; do
        docker rm -f "$container" >/dev/null 2>&1 || true
    done
    docker network rm "$network" >/dev/null 2>&1 || true
    rm -f "$password_file"
}

# scratch_start <container> [docker run options]: the owner is check/check on
# database check; vetchium_app's password is check-app-password.
scratch_start() {
    container=$1
    shift
    containers="$containers $container"
    docker run -d --name "$container" --network "$network" "$@" \
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
    until docker exec "$container" \
        pg_isready -q -h 127.0.0.1 -U check -d check 2>/dev/null; do
        attempts=$((attempts + 1))
        if [ "$attempts" -ge 60 ]; then
            echo "$container: PostgreSQL did not become ready" >&2
            docker logs "$container" >&2
            exit 1
        fi
        sleep 1
    done
}

# scratch_goose <container> <migration set> <goose arguments>
scratch_goose() {
    container=$1
    image=$(docker build -q "$root/db/$2")
    shift 2
    docker run --rm --network "$network" \
        -e "GOOSE_DBSTRING=postgres://check:check@$container:5432/check?sslmode=disable" \
        "$image" "$@" >/dev/null
}
