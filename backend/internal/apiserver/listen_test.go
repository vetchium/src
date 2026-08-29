package apiserver

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestListenAddressDefaultsToTheContainerPort(t *testing.T) {
	t.Setenv(ListenAddressEnv, "")
	address, err := ListenAddress()
	if err != nil {
		t.Fatalf("ListenAddress() error = %v", err)
	}
	if address != DefaultListenAddress {
		t.Fatalf("address = %q, want %q", address, DefaultListenAddress)
	}
}

func TestListenAddressAcceptsADevelopmentOverride(t *testing.T) {
	for _, address := range []string{
		":8081", "127.0.0.1:8081", "localhost:0", "[::1]:8081",
	} {
		t.Run(address, func(t *testing.T) {
			t.Setenv(ListenAddressEnv, address)
			got, err := ListenAddress()
			if err != nil {
				t.Fatalf("ListenAddress() error = %v", err)
			}
			if got != address {
				t.Fatalf("address = %q, want %q", got, address)
			}
		})
	}
}

func TestListenAddressRejectsAnAddressWithoutAPort(t *testing.T) {
	for _, address := range []string{"8081", "127.0.0.1", "127.0.0.1:", ":"} {
		t.Run(address, func(t *testing.T) {
			t.Setenv(ListenAddressEnv, address)
			if _, err := ListenAddress(); err == nil {
				t.Fatalf("ListenAddress() accepted %q", address)
			}
		})
	}
}

func TestSelfCheckReachesTheOverriddenPortOverLoopback(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(HealthCheck))
	defer server.Close()

	// The listener binds an arbitrary port; SelfCheck must follow it there
	// rather than assuming the default.
	_, port, found := strings.Cut(strings.TrimPrefix(server.URL, "http://"), ":")
	if !found {
		t.Fatalf("test server URL = %q", server.URL)
	}
	if err := SelfCheck(":" + port); err != nil {
		t.Fatalf("SelfCheck() error = %v", err)
	}
}

func TestSelfCheckReportsAnUnhealthyServer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(
		func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable)
		},
	))
	defer server.Close()

	_, port, _ := strings.Cut(strings.TrimPrefix(server.URL, "http://"), ":")
	if err := SelfCheck(":" + port); err == nil {
		t.Fatal("SelfCheck() accepted an unhealthy server")
	}
}

func TestSelfCheckRejectsAnAddressWithoutAPort(t *testing.T) {
	if err := SelfCheck("127.0.0.1"); err == nil {
		t.Fatal("SelfCheck() accepted an address without a port")
	}
}
