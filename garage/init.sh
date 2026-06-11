#!/bin/sh
# Idempotent bootstrap for the single Garage node. Runs in the node's network
# namespace (network_mode: service:garage) with the node's metadata mounted, so the
# CLI talks to it over localhost via the config (no node-id wrangling needed).
# Assigns a single-node layout, imports the fixed S3 key, creates every bucket in
# $BUCKETS, grants access. Re-runnable (skips already-configured steps).
set -eu

: "${GARAGE_RPC_SECRET:?}"
: "${S3_ACCESS_KEY_ID:?}"
: "${S3_SECRET_ACCESS_KEY:?}"
: "${BUCKETS:?}"

g() { garage -c /etc/garage.toml "$@"; }

echo ">>> waiting for local garage node ..."
i=0
until g status >/dev/null 2>&1; do
  i=$((i + 1))
  [ "$i" -ge 60 ] && {
    echo "timeout waiting for garage node" >&2
    exit 1
  }
  sleep 2
done

if g status 2>/dev/null | grep -q 'NO ROLE ASSIGNED'; then
  node="$(g node id -q | cut -d@ -f1)"
  echo ">>> assigning single-node layout to $node"
  g layout assign -z dc1 -c 1G "$node"
  g layout apply --version 1
else
  echo ">>> layout already configured"
fi

if g key info "$S3_ACCESS_KEY_ID" >/dev/null 2>&1; then
  echo ">>> key already present"
else
  echo ">>> importing key $S3_ACCESS_KEY_ID"
  g key import --yes "$S3_ACCESS_KEY_ID" "$S3_SECRET_ACCESS_KEY"
fi

for b in $BUCKETS; do
  g bucket info "$b" >/dev/null 2>&1 || g bucket create "$b"
  g bucket allow --read --write --owner "$b" --key "$S3_ACCESS_KEY_ID"
  echo ">>> bucket $b ready"
done

echo ">>> garage bootstrap complete"
