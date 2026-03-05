package audit

import (
	"net"
	"net/http"
	"strings"
)

// ExtractClientIP extracts the client IP address from the request.
// It checks X-Forwarded-For first (first entry), then falls back to RemoteAddr.
func ExtractClientIP(r *http.Request) string {
	xff := r.Header.Get("X-Forwarded-For")
	if xff != "" {
		parts := strings.SplitN(xff, ",", 2)
		ip := strings.TrimSpace(parts[0])
		if ip != "" {
			return ip
		}
	}

	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
