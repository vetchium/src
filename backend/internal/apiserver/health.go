package apiserver

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"time"
)

// HealthCheck reports that this process is accepting HTTP connections.
func HealthCheck(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
}

// SelfCheck backs the "healthcheck" CLI subcommand, since the distroless
// runtime image has no shell or curl for a Docker HEALTHCHECK to use instead.
// Only the port is taken from the listen address: a server bound to one
// interface is still reached over the loopback the subcommand runs on.
func SelfCheck(address string) error {
	return selfCheck(address, nil)
}

func SelfCheckTLS(address string, tlsConfig *tls.Config) error {
	if tlsConfig == nil {
		return fmt.Errorf("TLS healthcheck configuration is required")
	}
	return selfCheck(address, tlsConfig)
}

func selfCheck(address string, tlsConfig *tls.Config) error {
	port, err := listenPort(address)
	if err != nil {
		return err
	}
	scheme := "http"
	transport := http.DefaultTransport
	if tlsConfig != nil {
		scheme = "https"
		transport = &http.Transport{TLSClientConfig: tlsConfig}
	}
	client := http.Client{Timeout: 2 * time.Second, Transport: transport}
	resp, err := client.Get(
		scheme + "://" + net.JoinHostPort("127.0.0.1", port) + "/healthz",
	)
	if err != nil {
		return err
	}
	defer func() {
		_ = resp.Body.Close()
	}()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("healthz returned status %d", resp.StatusCode)
	}
	return nil
}
