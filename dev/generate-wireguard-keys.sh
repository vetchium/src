#!/bin/sh
set -eu

# Generates the development mesh's WireGuard keypairs. Production keys live in
# each host's own encrypted configuration; these exist only so Compose can
# stand up the same peer topology locally.

if [ "$#" -lt 2 ]; then
  echo "usage: $0 OUTPUT_DIR NODE..." >&2
  exit 2
fi

output_dir=$1
shift
mkdir -p "$output_dir"

expected=""
for node in "$@"; do
  expected="$expected wireguard_${node}_private_key wireguard_${node}_public_key"
done

present=0
missing=0
for name in $expected; do
  if [ -f "$output_dir/$name" ]; then
    present=$((present + 1))
  else
    missing=$((missing + 1))
  fi
done
if [ "$missing" -eq 0 ]; then
  exit 0
fi
if [ "$present" -ne 0 ]; then
  echo "WireGuard keys are incomplete in $output_dir; remove its wireguard_* files before regenerating" >&2
  exit 1
fi

work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT

# WireGuard wants the bare 32-byte X25519 scalars in base64. OpenSSL emits
# PKCS#8 and SPKI, whose fixed-length headers precede exactly those bytes.
for node in "$@"; do
  openssl genpkey -algorithm X25519 -outform DER -out "$work_dir/$node.der" \
    >/dev/null 2>&1
  tail -c 32 "$work_dir/$node.der" | openssl base64 -A \
    > "$work_dir/wireguard_${node}_private_key"
  openssl pkey -inform DER -in "$work_dir/$node.der" -pubout -outform DER \
    2>/dev/null | tail -c 32 | openssl base64 -A \
    > "$work_dir/wireguard_${node}_public_key"
done

umask 077
for name in $expected; do
  mv "$work_dir/$name" "$output_dir/$name"
done
