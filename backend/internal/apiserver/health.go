package apiserver

import (
	"fmt"
	"net/http"
	"time"
)

// HealthCheck reports that this process is accepting HTTP connections.
func HealthCheck(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
}

// SelfCheck backs the "healthcheck" CLI subcommand, since the distroless
// runtime image has no shell or curl for a Docker HEALTHCHECK to use instead.
func SelfCheck(address string) error {
	client := http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://127.0.0.1" + address + "/healthz")
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
