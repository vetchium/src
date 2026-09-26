# Mesh Topology

Applies to mesh and global-coordinator deployment: certificates and rotation,
listener binding, WireGuard, DNS, firewalls, and the development/CI Compose
networks. Trust and protocol rules are in [`federation.md`](federation.md).

## Certificates and keys

- Keep private keys in mounted secrets. Support overlapping rotation: accept a CA
  bundle and version Docker secret names, so operators can deploy an old-plus-new
  trust bundle, roll each leaf certificate, then remove the old CA, without
  distributing mesh keys to browser-facing processes.
- Each tenant mesh API has separate client and server key pairs. The server
  certificate covers `<tenant-id>.mesh.vetchium.com`, which private DNS resolves
  to the tenant host's WireGuard address.
- The coordinator's container healthcheck uses its own client-auth certificate
  (see `federation.md` for what it may reach).

## Production

- Production publishes only the peer listener, in host mode, and the host
  firewall restricts that port to the WireGuard interface. The peer listener
  binds only its WireGuard address so cross-tenant traffic cannot fall back to
  the underlay. The tenant-local relay stays on all interfaces because its
  callers share the host.
- Coordinator DNS resolves only to its WireGuard address. Deployment must verify
  the tenant route uses the configured WireGuard interface, and the coordinator
  host firewall must drop its published port on every public interface.
- Production WireGuard keys live in each host's own encrypted configuration and
  are never generated in this repository.

## Development and CI Compose

- Run real WireGuard, not a plain Docker network. Each tenant and the coordinator
  get a `wg-*` node built from `dev/wireguard/` with a `wg0` interface at a
  `10.242.0.0/24` address; the matching `mesh-api` or `global-coordinator` joins
  that node's network namespace. The `mesh` Docker network is only the underlay
  those nodes use to find each other.
- Each node's hosts file maps every `*.mesh.vetchium.com` name to a WireGuard
  address, so peers verify the same server name and take the same encrypted path
  in every environment. A namespace-sharing service inherits its donor's hosts
  file, so mappings belong on the `wg-*` node; `extra_hosts` on the service
  itself is refused.
- The relay's callers are the tenant's own API servers and workers on the backend
  network.
- `make dev-secrets` generates development WireGuard keypairs.
- Each isolated network gets a distinct `/24` within `10.231.0.0/16`. The
  four-tenant topology exceeds Docker's default address-pool capacity on some
  hosts; do not merge tenant networks to work around it. If the range overlaps a
  host VPN or LAN, set `VETCHIUM_DOCKER_NETWORK_OCTET` to a free second octet for
  the whole Compose project before startup. Keep development and CI mappings
  identical.
