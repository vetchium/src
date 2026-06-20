#!/usr/bin/env bash
# Run the full exploratory UI pass, in order. Phases hand ids to later phases via
# JSON files under exploratory/output/issues/, so they MUST run sequentially.
#
# Prereqs (see README.md):
#   - docker compose -f docker-compose-full.json up --build -d   (from src/)
#   - wait for the `seed-users` container to exit 0
#   - cd playwright && npm install   (provides node_modules/playwright + browsers)
#
# Usage:
#   cd playwright
#   ./exploratory/run-all.sh            # all phases
#   ./exploratory/run-all.sh 00 01 04   # only the named phases
set -uo pipefail
cd "$(dirname "$0")/.."                       # -> playwright/
export NODE_PATH="$(pwd)/node_modules"

# Portable to macOS bash 3.2 (no `mapfile`).
files=()
if [ "$#" -eq 0 ]; then
  for f in $(ls exploratory/scripts/*.js | sort); do files+=("$f"); done
else
  for p in "$@"; do
    for f in exploratory/scripts/${p}-*.js; do
      [ -e "$f" ] && files+=("$f")
    done
  done
fi

fail=0
for f in "${files[@]}"; do
  [ -z "$f" ] && continue
  echo "=================================================================="
  echo ">>> $f"
  echo "=================================================================="
  node "$f" || { echo "!!! phase failed: $f"; fail=1; }
done

echo
echo "Artefacts: exploratory/output/  (shots/  profiles/  issues/)"
echo "------------------------------------------------------------------"
node exploratory/aggregate.js
exit $fail
