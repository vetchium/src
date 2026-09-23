#!/bin/sh
set -eu

if [ "$#" -lt 2 ]; then
  echo "usage: $0 OUTPUT_DIR TENANT_ID..." >&2
  exit 2
fi

output_dir=$1
shift
mkdir -p "$output_dir"

expected="mesh_ca_certificate mesh_ca_key global_coordinator_tls_certificate global_coordinator_tls_key global_coordinator_health_certificate global_coordinator_health_key"
for tenant_id in "$@"; do
  expected="$expected mesh_client_${tenant_id}_certificate mesh_client_${tenant_id}_key mesh_server_${tenant_id}_certificate mesh_server_${tenant_id}_key"
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
  echo "mesh PKI is incomplete in $output_dir; remove its mesh_* and global_coordinator_tls_* files before regenerating" >&2
  exit 1
fi

work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT

openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 825 \
  -subj "/CN=Vetchium development mesh CA" \
  -keyout "$work_dir/mesh_ca_key" \
  -out "$work_dir/mesh_ca_certificate" >/dev/null 2>&1

openssl req -newkey rsa:3072 -nodes -sha256 \
  -subj "/CN=global-coordinator.mesh.vetchium.com" \
  -keyout "$work_dir/global_coordinator_tls_key" \
  -out "$work_dir/global-coordinator.csr" >/dev/null 2>&1
printf '%s\n' \
  'basicConstraints=critical,CA:FALSE' \
  'keyUsage=critical,digitalSignature,keyEncipherment' \
  'extendedKeyUsage=serverAuth' \
  'subjectAltName=DNS:global-coordinator.mesh.vetchium.com,DNS:global-coordinator' \
  > "$work_dir/server.ext"
openssl x509 -req -sha256 -days 825 \
  -in "$work_dir/global-coordinator.csr" \
  -CA "$work_dir/mesh_ca_certificate" \
  -CAkey "$work_dir/mesh_ca_key" -CAcreateserial \
  -extfile "$work_dir/server.ext" \
  -out "$work_dir/global_coordinator_tls_certificate" >/dev/null 2>&1

openssl req -newkey rsa:3072 -nodes -sha256 \
  -subj "/CN=global-coordinator healthcheck" \
  -keyout "$work_dir/global_coordinator_health_key" \
  -out "$work_dir/global-coordinator-health.csr" >/dev/null 2>&1
printf '%s\n' \
  'basicConstraints=critical,CA:FALSE' \
  'keyUsage=critical,digitalSignature,keyEncipherment' \
  'extendedKeyUsage=clientAuth' \
  'subjectAltName=URI:spiffe://mesh.vetchium.com/system/global-coordinator-health' \
  > "$work_dir/health.ext"
openssl x509 -req -sha256 -days 825 \
  -in "$work_dir/global-coordinator-health.csr" \
  -CA "$work_dir/mesh_ca_certificate" \
  -CAkey "$work_dir/mesh_ca_key" -CAcreateserial \
  -extfile "$work_dir/health.ext" \
  -out "$work_dir/global_coordinator_health_certificate" >/dev/null 2>&1

for tenant_id in "$@"; do
  openssl req -newkey rsa:3072 -nodes -sha256 \
    -subj "/CN=${tenant_id} mesh-api" \
    -keyout "$work_dir/mesh_client_${tenant_id}_key" \
    -out "$work_dir/${tenant_id}.csr" >/dev/null 2>&1
  printf '%s\n' \
    'basicConstraints=critical,CA:FALSE' \
    'keyUsage=critical,digitalSignature,keyEncipherment' \
    'extendedKeyUsage=clientAuth' \
    "subjectAltName=URI:spiffe://mesh.vetchium.com/tenant/${tenant_id}/mesh-api" \
    > "$work_dir/${tenant_id}.ext"
  openssl x509 -req -sha256 -days 825 \
    -in "$work_dir/${tenant_id}.csr" \
    -CA "$work_dir/mesh_ca_certificate" \
    -CAkey "$work_dir/mesh_ca_key" -CAcreateserial \
    -extfile "$work_dir/${tenant_id}.ext" \
    -out "$work_dir/mesh_client_${tenant_id}_certificate" >/dev/null 2>&1

  openssl req -newkey rsa:3072 -nodes -sha256 \
    -subj "/CN=${tenant_id}.mesh.vetchium.com" \
    -keyout "$work_dir/mesh_server_${tenant_id}_key" \
    -out "$work_dir/${tenant_id}-server.csr" >/dev/null 2>&1
  printf '%s\n' \
    'basicConstraints=critical,CA:FALSE' \
    'keyUsage=critical,digitalSignature,keyEncipherment' \
    'extendedKeyUsage=serverAuth' \
    "subjectAltName=DNS:${tenant_id}.mesh.vetchium.com" \
    > "$work_dir/${tenant_id}-server.ext"
  openssl x509 -req -sha256 -days 825 \
    -in "$work_dir/${tenant_id}-server.csr" \
    -CA "$work_dir/mesh_ca_certificate" \
    -CAkey "$work_dir/mesh_ca_key" -CAcreateserial \
    -extfile "$work_dir/${tenant_id}-server.ext" \
    -out "$work_dir/mesh_server_${tenant_id}_certificate" >/dev/null 2>&1
done

umask 077
for name in $expected; do
  mv "$work_dir/$name" "$output_dir/$name"
done
