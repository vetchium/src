#!/bin/sh
set -eu

: "${APP_POSTGRES_PASSWORD_FILE:?APP_POSTGRES_PASSWORD_FILE is required}"

if [ ! -r "$APP_POSTGRES_PASSWORD_FILE" ]; then
    echo "APP_POSTGRES_PASSWORD_FILE is not readable: $APP_POSTGRES_PASSWORD_FILE" >&2
    exit 1
fi

POSTGRES_APP_PASSWORD=$(cat "$APP_POSTGRES_PASSWORD_FILE")
if [ -z "$POSTGRES_APP_PASSWORD" ]; then
    echo "APP_POSTGRES_PASSWORD_FILE is empty" >&2
    exit 1
fi
export POSTGRES_APP_PASSWORD

# Delegate all initialization and normal startup behavior to the official
# entrypoint. It removes POSTGRES_* variables before starting the server, so the
# application password is available to init.sql but not retained by postgres.
exec /usr/local/bin/docker-entrypoint.sh "$@"
