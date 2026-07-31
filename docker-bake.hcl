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
    "worker",
    "migrate",
    "orgs-ui",
    "hub-ui",
    "admin-ui",
  ]
}

target "_common" {
  platforms = PLATFORMS == "" ? null : split(",", PLATFORMS)
}

target "admin-api" {
  inherits = ["_common"]
  context = "backend"
  target  = "admin-api"
  tags    = ["${REGISTRY}/admin-api:${TAG}"]
}

target "hub-api" {
  inherits = ["_common"]
  context = "backend"
  target  = "hub-api"
  tags    = ["${REGISTRY}/hub-api:${TAG}"]
}

target "orgs-api" {
  inherits = ["_common"]
  context = "backend"
  target  = "orgs-api"
  tags    = ["${REGISTRY}/orgs-api:${TAG}"]
}

target "mesh-api" {
  inherits = ["_common"]
  context = "backend"
  target  = "mesh-api"
  tags    = ["${REGISTRY}/mesh-api:${TAG}"]
}

target "mcp-server" {
  inherits = ["_common"]
  context = "backend"
  target  = "mcp-server"
  tags    = ["${REGISTRY}/mcp-server:${TAG}"]
}

target "worker" {
  inherits = ["_common"]
  context = "backend"
  target  = "worker"
  tags    = ["${REGISTRY}/worker:${TAG}"]
}

target "migrate" {
  inherits = ["_common"]
  context = "migrations"
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
  context = "admin-ui"
  tags    = ["${REGISTRY}/admin-ui:${TAG}"]
}
