#!/bin/sh
set -eu

# WIREGUARD_ADDRESS is this node's mesh address. WIREGUARD_PEERS lists the
# other nodes as "publicKeyFile=address=endpointHost" triples, separated by
# spaces, so one image serves every node without a per-node config file.

: "${WIREGUARD_ADDRESS:?missing WIREGUARD_ADDRESS}"
: "${WIREGUARD_PEERS:?missing WIREGUARD_PEERS}"
listen_port=${WIREGUARD_LISTEN_PORT:-51820}

ip link add wg0 type wireguard
ip address add "$WIREGUARD_ADDRESS/32" dev wg0
wg set wg0 listen-port "$listen_port" \
  private-key /run/secrets/wireguard_private_key
# Routes toward peers can only be installed once the interface is up.
ip link set wg0 up

for peer in $WIREGUARD_PEERS; do
  key_file=${peer%%=*}
  rest=${peer#*=}
  address=${rest%%=*}
  endpoint_host=${rest#*=}
  # A development endpoint is a Compose service name on the underlay network,
  # which Docker may not have an address for until that node starts. WireGuard
  # re-resolves on the next handshake, so a miss here is not fatal.
  resolved=$(getent hosts "$endpoint_host" | awk 'NR==1 {print $1}' || true)
  if [ -n "$resolved" ]; then
    wg set wg0 peer "$(cat "$key_file")" \
      endpoint "$resolved:$listen_port" \
      persistent-keepalive 25 \
      allowed-ips "$address/32"
  else
    wg set wg0 peer "$(cat "$key_file")" \
      persistent-keepalive 25 \
      allowed-ips "$address/32"
  fi
  ip route replace "$address/32" dev wg0
done

# Re-resolve endpoints that were not yet known, then idle holding the
# namespace open for the services that share it.
while true; do
  sleep 30
  for peer in $WIREGUARD_PEERS; do
    key_file=${peer%%=*}
    rest=${peer#*=}
    address=${rest%%=*}
    endpoint_host=${rest#*=}
    public_key=$(cat "$key_file")
    handshake=$(wg show wg0 latest-handshakes |
      awk -v key="$public_key" '$1 == key {print $2}')
    if [ "${handshake:-0}" != "0" ]; then
      continue
    fi
    resolved=$(getent hosts "$endpoint_host" | awk 'NR==1 {print $1}' || true)
    if [ -n "$resolved" ]; then
      wg set wg0 peer "$public_key" endpoint "$resolved:$listen_port"
    fi
  done
done
