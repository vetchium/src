variable "REGISTRY" {
  default = "ghcr.io/vetchium"
}

variable "TAG" {
  default = "dev"
}

variable "PLATFORMS" {
  default = ""
}

# Every image is pushed under TAG and `latest`; `make staging` deploys `latest`.
function "tags" {
  params = [name]
  result = ["${REGISTRY}/${name}:${TAG}", "${REGISTRY}/${name}:latest"]
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
  labels = {
    "org.opencontainers.image.version" = TAG
  }
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
  tags    = tags("admin-api")
}

target "hub-api" {
  inherits = ["_backend"]
  target  = "hub-api"
  tags    = tags("hub-api")
}

target "orgs-api" {
  inherits = ["_backend"]
  target  = "orgs-api"
  tags    = tags("orgs-api")
}

target "mesh-api" {
  inherits = ["_backend"]
  target  = "mesh-api"
  tags    = tags("mesh-api")
}

target "mcp-server" {
  inherits = ["_backend"]
  target  = "mcp-server"
  tags    = tags("mcp-server")
}

target "workers" {
  inherits = ["_backend"]
  target  = "workers"
  tags    = tags("workers")
}

target "global-coordinator" {
  inherits = ["_backend"]
  target  = "global-coordinator"
  tags    = tags("global-coordinator")
}

target "migrate" {
  inherits = ["_common"]
  context = "db/migrations"
  tags    = tags("migrate")
}

target "global-migrate" {
  inherits = ["_common"]
  context = "db/global-migrations"
  tags    = tags("global-migrate")
}

target "admin-ui" {
  inherits = ["_common"]
  context = "."
  dockerfile = "admin-ui/Dockerfile"
  tags    = tags("admin-ui")
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
  tags    = tags("hub-ui-staging")
}

target "orgs-ui-staging" {
  inherits = ["_common"]
  context = "."
  dockerfile = "orgs-ui/Dockerfile"
  args = {
    VITE_VETCHIUM_ENVIRONMENT = "staging"
  }
  tags    = tags("orgs-ui-staging")
}

# Stands in for a mesh host's WireGuard interface in staging, as it does in
# dev and CI.
target "wireguard-node" {
  inherits = ["_common"]
  context = "."
  dockerfile = "dev/wireguard/Dockerfile"
  tags    = tags("wireguard-node")
}
