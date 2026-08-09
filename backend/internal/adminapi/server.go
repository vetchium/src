package adminapi

import (
	"net"
	"sync"
	"time"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
)

type Server struct {
	*apiserver.Runtime

	Queries sqlc.Querier

	// Values below come from the shared application config.
	TenantID          string
	AdminSessionTTL   time.Duration
	TrustedProxyCIDRs []net.IPNet
	CredentialKey     [32]byte
	Now               func() time.Time
	rateLimitMu       sync.Mutex
	rateLimits        map[string]rateLimitEntry
}

func (s *Server) CurrentTime() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

func (s *Server) CredentialSubkey(purpose string) [32]byte {
	return DeriveCredentialSubkey(s.CredentialKey, purpose)
}
