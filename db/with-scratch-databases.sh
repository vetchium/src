#!/bin/sh
# Runs a command against migrated scratch tenant and global databases, with
# TENANT_DATABASE_URL and GLOBAL_DATABASE_URL naming their owner role, and
# removes both afterwards. The Go database integration tests read these.
# Usage: db/with-scratch-databases.sh <postgres-image> <command> [args...]
set -eu

postgres_image=${1:?postgres image required}
shift
test "$#" -gt 0 || { echo "command required" >&2; exit 2; }
root=$(cd "$(dirname "$0")/.." && pwd)
run_id="vetchium-integration-$$"
. "$root/db/scratch-postgres.sh"
scratch_setup

# start <container> <migration set>: sets url to the owner URL on a loopback
# port. It runs in this shell, not $(...), so cleanup sees the container.
start() {
    scratch_start "$1" -p 127.0.0.1::5432
    scratch_goose "$1" "$2" up
    port=$(docker port "$1" 5432/tcp | sed -n 's/^127\.0\.0\.1://p' | head -n 1)
    test -n "$port" || { echo "$1: no published port" >&2; exit 1; }
    url="postgres://check:check@127.0.0.1:$port/check?sslmode=disable"
}

echo "==> scratch databases: migrate"
start "$run_id-tenant" migrations
TENANT_DATABASE_URL=$url
start "$run_id-global" global-migrations
GLOBAL_DATABASE_URL=$url
export TENANT_DATABASE_URL GLOBAL_DATABASE_URL

# Not exec: the EXIT trap removes the databases once the command finishes.
"$@"
