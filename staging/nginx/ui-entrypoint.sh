#!/bin/sh
# Runs via nginx:alpine's /docker-entrypoint.d before nginx starts.
# Writes the runtime config the SPA fetches from /config.json, from $API_URL.
set -e
: "${API_URL:=http://localhost:8080}"
printf '{"apiBaseUrl":"%s"}\n' "$API_URL" >/usr/share/nginx/html/config.json
echo "ui-entrypoint: wrote /config.json with apiBaseUrl=$API_URL"
