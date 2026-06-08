#!/usr/bin/env bash
# Stop the staging stack. Pass --wipe to also delete the DB volumes (fresh start).
set -euo pipefail
cd "$(dirname "$0")"
COMPOSE="docker compose -f docker-compose.json"
if [ "${1:-}" = "--wipe" ]; then
  echo ">>> Stopping and DELETING volumes..."
  $COMPOSE down -v
else
  echo ">>> Stopping (DB data preserved in named volumes)..."
  $COMPOSE down
fi
