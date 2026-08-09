package admin

import (
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/vetchium/src/typespec/problem"

	"backend/internal/adminapi"
)

const (
	adminRateLimit       = 5
	adminRateLimitWindow = time.Minute
	adminSourceRateLimit = 2000
	adminWorkRateLimit   = 250
)

func allowAdminRequest(
	s *adminapi.Server, w http.ResponseWriter, r *http.Request, key string,
) bool {
	return allowAdminRequestLimit(s, w, r, key, adminRateLimit)
}

func allowAdminRequestLimit(
	s *adminapi.Server, w http.ResponseWriter, r *http.Request,
	key string, limit int,
) bool {
	source := adminClientIP(s, r)
	if !allowAdminRateLimit(
		s, w, r, "admin-source:"+source, adminSourceRateLimit,
	) {
		return false
	}
	return allowAdminRateLimit(s, w, r, key, limit)
}

func allowAdminExpensiveRequest(
	s *adminapi.Server, w http.ResponseWriter, r *http.Request,
) bool {
	source := adminClientIP(s, r)
	return allowAdminRateLimit(
		s, w, r, "admin-expensive-source:"+source, adminWorkRateLimit,
	)
}

func adminClientIP(s *adminapi.Server, r *http.Request) string {
	remote := r.RemoteAddr
	if host, _, err := net.SplitHostPort(remote); err == nil {
		remote = host
	}
	address := net.ParseIP(remote)
	if address == nil || !trustedAdminProxy(s, address) {
		return remote
	}
	forwarded := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for index := len(forwarded) - 1; index >= 0; index-- {
		candidateText := strings.TrimSpace(forwarded[index])
		candidate := net.ParseIP(candidateText)
		if candidate == nil {
			continue
		}
		address = candidate
		if !trustedAdminProxy(s, candidate) {
			return candidate.String()
		}
	}
	return address.String()
}

func trustedAdminProxy(s *adminapi.Server, address net.IP) bool {
	for _, network := range s.TrustedProxyCIDRs {
		if network.Contains(address) {
			return true
		}
	}
	return false
}

func allowAdminRateLimit(
	s *adminapi.Server, w http.ResponseWriter, r *http.Request,
	key string, limit int,
) bool {
	allowed, retryAfter := s.AllowRequest(key, limit, adminRateLimitWindow)
	if allowed {
		return true
	}
	seconds := int(math.Ceil(retryAfter.Seconds()))
	if seconds < 0 {
		seconds = 0
	}
	w.Header().Set("Retry-After", strconv.Itoa(seconds))
	s.Problem(r.Context(), w, problem.RateLimitExceededError)
	return false
}
