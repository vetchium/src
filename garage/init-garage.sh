#!/bin/sh
# Initializes a single-node Garage S3 cluster for development.
# Uses the Garage admin API to set up layout, import a key, create a bucket,
# and grant access. All credentials are fixed dev-only values.
#
# Environment variables (all required):
#   GARAGE_ADMIN_URL    - Admin API base URL, e.g. http://garage-global:3903
#   GARAGE_ADMIN_TOKEN  - Admin bearer token
#   GARAGE_KEY_ID       - S3 access key ID to import
#   GARAGE_KEY_SECRET   - S3 secret access key to import
#   GARAGE_BUCKET       - S3 bucket name to create
set -e

apk add --no-cache curl jq >/dev/null 2>&1

echo "Waiting for Garage admin API at ${GARAGE_ADMIN_URL}..."
until curl -sf "${GARAGE_ADMIN_URL}/health" >/dev/null 2>&1; do
  sleep 2
done
echo "Garage is ready"

# Get cluster status: current layout version and the single node's ID
STATUS=$(curl -sf \
  -H "Authorization: Bearer ${GARAGE_ADMIN_TOKEN}" \
  "${GARAGE_ADMIN_URL}/v2/GetClusterStatus")

LAYOUT_VER=$(echo "${STATUS}" | jq -r '.layoutVersion')
NODE_ID=$(echo "${STATUS}" | jq -r '.nodes[0].id')

echo "Node ID: ${NODE_ID}, layout version: ${LAYOUT_VER}"

if [ "${LAYOUT_VER}" = "0" ]; then
  echo "Assigning node to layout..."
  curl -sf -XPOST \
    -H "Authorization: Bearer ${GARAGE_ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    "${GARAGE_ADMIN_URL}/v2/UpdateClusterLayout" \
    -d "{\"nodeId\":\"${NODE_ID}\",\"zone\":\"dc1\",\"capacity\":1073741824,\"tags\":[]}" \
    >/dev/null

  echo "Applying layout version 1..."
  curl -sf -XPOST \
    -H "Authorization: Bearer ${GARAGE_ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    "${GARAGE_ADMIN_URL}/v2/ApplyClusterLayout" \
    -d '{"version":1}' \
    >/dev/null
  echo "Layout initialized"
fi

# Import access key with predetermined dev credentials (idempotent)
echo "Importing access key ${GARAGE_KEY_ID}..."
curl -sf -XPOST \
  -H "Authorization: Bearer ${GARAGE_ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  "${GARAGE_ADMIN_URL}/v2/ImportKey" \
  -d "{\"accessKeyId\":\"${GARAGE_KEY_ID}\",\"secretAccessKey\":\"${GARAGE_KEY_SECRET}\",\"name\":\"vetchium-dev\"}" \
  >/dev/null 2>&1 || echo "Key already exists (continuing)"

# Create bucket (idempotent)
echo "Creating bucket ${GARAGE_BUCKET}..."
curl -sf -XPOST \
  -H "Authorization: Bearer ${GARAGE_ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  "${GARAGE_ADMIN_URL}/v2/CreateBucket" \
  -d "{\"globalAlias\":\"${GARAGE_BUCKET}\"}" \
  >/dev/null 2>&1 || echo "Bucket already exists (continuing)"

# Find bucket ID by alias
BUCKET_ID=$(curl -sf \
  -H "Authorization: Bearer ${GARAGE_ADMIN_TOKEN}" \
  "${GARAGE_ADMIN_URL}/v2/ListBuckets" | \
  jq -r --arg alias "${GARAGE_BUCKET}" \
  '.[] | select(.globalAliases[] == $alias) | .id')

if [ -z "${BUCKET_ID}" ]; then
  echo "ERROR: Could not find bucket '${GARAGE_BUCKET}'"
  exit 1
fi
echo "Bucket ID: ${BUCKET_ID}"

# Grant read/write/owner access to the key (idempotent)
echo "Granting bucket access to key ${GARAGE_KEY_ID}..."
curl -sf -XPOST \
  -H "Authorization: Bearer ${GARAGE_ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  "${GARAGE_ADMIN_URL}/v2/AllowBucketKey" \
  -d "{\"bucketId\":\"${BUCKET_ID}\",\"accessKeyId\":\"${GARAGE_KEY_ID}\",\"permissions\":{\"read\":true,\"write\":true,\"owner\":true}}" \
  >/dev/null 2>&1 || true

echo "Garage initialization complete!"
