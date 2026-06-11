#!/usr/bin/env bash
# Bring up the production-like staging stack (pulls images from GHCR, then starts).
# Reads staging/.env (SMTP relay + initial admin). Prereqs:
#   cp staging/.env.example staging/.env   # then fill SMTP_* and STAGING_ADMIN_*
#   gh auth token | docker login ghcr.io -u <you> --password-stdin
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "staging/.env missing - run:  cp staging/.env.example staging/.env  and fill it in." >&2
  exit 1
fi

COMPOSE="docker compose -f docker-compose.json"

echo ">>> Pulling images from GHCR..."
$COMPOSE pull

echo ">>> Starting staging stack..."
$COMPOSE up -d

$COMPOSE ps

cat <<'EOF'

Staging stack is starting. Host ports (fronted by the Cloudflare tunnel):
  8091 vm-global   8092 vm-ind1   8093 vm-usa1   8094 vm-deu1
  8095 hub-ui      8096 org-ui    8097 admin-ui
  8025 mailpit web UI (captured email; not tunneled)

Next: start the tunnel ->  cloudflared/run.sh   (one-time setup: cloudflared/setup-tunnel.sh)
Then open https://hub-staging.vetchium.com / org-staging / admin-staging .vetchium.com
EOF
