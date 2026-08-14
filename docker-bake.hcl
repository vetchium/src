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
    "migrate",
    "orgs-ui",
    "hub-ui",
    "admin-ui",
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

target "migrate" {
  inherits = ["_common"]
  context = "db/migrations"
  tags    = ["${REGISTRY}/migrate:${TAG}"]
}

target "orgs-ui" {
  inherits = ["_common"]
  context = "orgs-ui"
  tags    = ["${REGISTRY}/orgs-ui:${TAG}"]
}

target "hub-ui" {
  inherits = ["_common"]
  context = "hub-ui"
  tags    = ["${REGISTRY}/hub-ui:${TAG}"]
}

target "admin-ui" {
  inherits = ["_common"]
  context = "."
  dockerfile = "admin-ui/Dockerfile"
  tags    = ["${REGISTRY}/admin-ui:${TAG}"]
}
