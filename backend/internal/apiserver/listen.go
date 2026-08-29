package apiserver

import (
	"fmt"
	"net"
	"os"
)

// ListenAddressEnv names the per-process override for the HTTP listen address.
const ListenAddressEnv = "LISTEN_ADDRESS"

// DefaultListenAddress is the port every container image, Compose service, and
// deployment manifest expects. Changing it breaks the healthchecks and Traefik
// routing that address services by name on this port.
const DefaultListenAddress = ":8080"

// ListenAddress reports the address this process binds its HTTP server to.
//
// Each tenant service listens on the same port inside its own container, so the
// default is what production uses. The override exists for development, where
// several APIs run as ordinary processes on one host and cannot all take 8080.
func ListenAddress() (string, error) {
	address := os.Getenv(ListenAddressEnv)
	if address == "" {
		return DefaultListenAddress, nil
	}
	port, err := listenPort(address)
	if err != nil {
		return "", err
	}
	if _, err := net.LookupPort("tcp", port); err != nil {
		return "", fmt.Errorf(
			"%s must name a TCP port, got %q", ListenAddressEnv, address,
		)
	}
	return address, nil
}

// listenPort extracts the port from a Go listen address, which may omit the
// host entirely as ":8080" does.
func listenPort(address string) (string, error) {
	_, port, err := net.SplitHostPort(address)
	if err != nil || port == "" {
		return "", fmt.Errorf(
			"%s must be a host:port listen address, got %q",
			ListenAddressEnv, address,
		)
	}
	return port, nil
}
