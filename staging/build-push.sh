#!/usr/bin/env bash
# Build the 7 Vetchium images and push them to GHCR under ghcr.io/vetchium/*.
#
# This is the ONLY way images are built/pushed - there is no CI. Run it on your
# laptop when you want to publish new images, then bring staging up (up.sh).
# The UIs use their Dockerfile.prod (static nginx build); the dev flow keeps using
# each UI's plain ./Dockerfile (bun serve.ts) and is untouched by this script.
#
# Prereq: docker login ghcr.io  (a gh token with write:packages works:
#   gh auth token | docker login ghcr.io -u <user> --password-stdin )
#
# Builds for the host architecture (the staging "VMs" run on this machine, so that
# matches). For amd64 prod VMs from an arm laptop, build with:
#   docker buildx build --platform linux/amd64 --push -t <img> -f <dockerfile> <ctx>
set -euo pipefail

REGISTRY="ghcr.io/vetchium"
TAG="${1:-staging}"

# Repo root = parent of this script's dir.
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo "Building from repo root: $ROOT  (tag: $TAG)"

build() {
  local name="$1" dockerfile="$2" context="$3"
  echo "=================================================================="
  echo ">>> Building $REGISTRY/$name:$TAG  (-f $dockerfile  ctx $context)"
  echo "=================================================================="
  docker build -t "$REGISTRY/$name:$TAG" -f "$dockerfile" "$context"
  docker push "$REGISTRY/$name:$TAG"
}

# Backend (Go). Order chosen so shared golang:1.25-alpine builder layers cache.
build migrate            api-server/Dockerfile.migrate          api-server
build regional-api-server api-server/Dockerfile.regional        .
build global-service     api-server/Dockerfile.global-service   .
build regional-worker    api-server/Dockerfile.regional-worker  .

# Frontend (Bun -> static nginx). Uses Dockerfile.prod, NOT the dev ./Dockerfile.
build hub-ui             hub-ui/Dockerfile.prod                 .
build org-ui             org-ui/Dockerfile.prod                 .
build admin-ui           admin-ui/Dockerfile.prod               .

echo "All 7 images built & pushed to $REGISTRY (tag: $TAG)."
