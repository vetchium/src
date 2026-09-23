# A development stand-in for a production mesh host's WireGuard interface.
# Each tenant and the coordinator run one of these; their mesh services then
# share this container's network namespace, so every cross-node packet leaves
# over wg0 exactly as it does between production VMs.
FROM alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce

# curl is here for the contract-coverage suite: the mesh listeners answer only
# inside this namespace, and BusyBox wget can neither present a client
# certificate nor return the body of a problem response.
RUN apk add --no-cache wireguard-tools iproute2 iptables curl

COPY dev/wireguard/entrypoint.sh /usr/local/bin/wireguard-node
RUN chmod +x /usr/local/bin/wireguard-node

ENTRYPOINT ["/usr/local/bin/wireguard-node"]
