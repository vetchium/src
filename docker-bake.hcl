variable "REGISTRY" {
  default = "ghcr.io/vetchium"
}

variable "TAG" {
  default = "dev"
}

variable "PLATFORMS" {
  default = ""
}

group "default" {
  targets = [
    "admin-api",
    "hub-api",
    "orgs-api",
    "mesh-api",
    "mcp-server",
    "workers",
    "global-coordinator",
    "global-migrate",
    "migrate",
    "admin-ui",
    "hub-ui-staging",
    "orgs-ui-staging",
    "wireguard-node",
  ]
}

target "_common" {
  platforms = PLATFORMS == "" ? null : split(",", PLATFORMS)
}

target "_backend" {
  inherits = ["_common"]
  context = "."
  dockerfile = "backend/Dockerfile"
  args = {
    VERSION = TAG
  }
}

target "admin-api" {
  inherits = ["_backend"]
  target  = "admin-api"
  tags    = ["${REGISTRY}/admin-api:${TAG}"]
}

target "hub-api" {
  inherits = ["_backend"]
  target  = "hub-api"
  tags    = ["${REGISTRY}/hub-api:${TAG}"]
}

target "orgs-api" {
  inherits = ["_backend"]
  target  = "orgs-api"
  tags    = ["${REGISTRY}/orgs-api:${TAG}"]
}

target "mesh-api" {
  inherits = ["_backend"]
  target  = "mesh-api"
  tags    = ["${REGISTRY}/mesh-api:${TAG}"]
}

target "mcp-server" {
  inherits = ["_backend"]
  target  = "mcp-server"
  tags    = ["${REGISTRY}/mcp-server:${TAG}"]
}

target "workers" {
  inherits = ["_backend"]
  target  = "workers"
  tags    = ["${REGISTRY}/workers:${TAG}"]
}

target "global-coordinator" {
  inherits = ["_backend"]
  target  = "global-coordinator"
  tags    = ["${REGISTRY}/global-coordinator:${TAG}"]
}

target "migrate" {
  inherits = ["_common"]
  context = "db/migrations"
  tags    = ["${REGISTRY}/migrate:${TAG}"]
}

target "global-migrate" {
  inherits = ["_common"]
  context = "db/global-migrations"
  tags    = ["${REGISTRY}/global-migrate:${TAG}"]
}

target "admin-ui" {
  inherits = ["_common"]
  context = "."
  dockerfile = "admin-ui/Dockerfile"
  tags    = ["${REGISTRY}/admin-ui:${TAG}"]
}

# Production serves the Hub and Orgs portals from a static host (`make
# portal-dist`); staging runs them as containers, each compiled with the
# staging region table.
target "hub-ui-staging" {
  inherits = ["_common"]
  context = "."
  dockerfile = "hub-ui/Dockerfile"
  args = {
    VITE_VETCHIUM_ENVIRONMENT = "staging"
  }
  tags    = ["${REGISTRY}/hub-ui-staging:${TAG}"]
}

target "orgs-ui-staging" {
  inherits = ["_common"]
  context = "."
  dockerfile = "orgs-ui/Dockerfile"
  args = {
    VITE_VETCHIUM_ENVIRONMENT = "staging"
  }
  tags    = ["${REGISTRY}/orgs-ui-staging:${TAG}"]
}

# Stands in for a mesh host's WireGuard interface in staging, as it does in
# dev and CI.
target "wireguard-node" {
  inherits = ["_common"]
  context = "."
  dockerfile = "dev/wireguard/Dockerfile"
  tags    = ["${REGISTRY}/wireguard-node:${TAG}"]
}
