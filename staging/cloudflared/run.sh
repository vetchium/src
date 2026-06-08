#!/usr/bin/env bash
# Run the cloudflared tunnel using the repo-local config (foreground).
# Run setup-tunnel.sh once first. Ctrl-C to stop.
set -euo pipefail
CFG_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ ! -f "$CFG_DIR/config.yml" ]; then
  echo "config.yml missing - run staging/cloudflared/setup-tunnel.sh first." >&2
  exit 1
fi
exec cloudflared tunnel --config "$CFG_DIR/config.yml" run
