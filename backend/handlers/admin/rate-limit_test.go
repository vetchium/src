package admin

import (
	"net"
	"net/http/httptest"
	"testing"

	"backend/internal/adminapi"
)

func TestAdminClientIPTrustsOnlyConfiguredProxyChains(t *testing.T) {
	_, trustedNetwork, err := net.ParseCIDR("172.16.0.0/12")
	if err != nil {
		t.Fatal(err)
	}
	s := &adminapi.Server{TrustedProxyCIDRs: []net.IPNet{*trustedNetwork}}

	tests := []struct {
		name       string
		remoteAddr string
		forwarded  string
		want       string
	}{
		{
			name:       "untrusted direct caller cannot spoof forwarding headers",
			remoteAddr: "203.0.113.10:1234", forwarded: "198.51.100.2",
			want: "203.0.113.10",
		},
		{
			name:       "trusted proxy exposes direct client",
			remoteAddr: "172.30.0.2:1234", forwarded: "198.51.100.2",
			want: "198.51.100.2",
		},
		{
			name:       "trusted chain selects nearest untrusted client hop",
			remoteAddr: "172.30.0.2:1234",
			forwarded:  "192.0.2.4, 198.51.100.8, 172.29.0.3",
			want:       "198.51.100.8",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest("GET", "/", nil)
			request.RemoteAddr = tt.remoteAddr
			request.Header.Set("X-Forwarded-For", tt.forwarded)
			if got := adminClientIP(s, request); got != tt.want {
				t.Fatalf("adminClientIP() = %q, want %q", got, tt.want)
			}
		})
	}
}
