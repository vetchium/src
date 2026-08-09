package adminapi

import (
	"time"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
)

type Server struct {
	*apiserver.Runtime

	Queries sqlc.Querier

	// Values below come from the shared application config.
	TenantID        string
	AdminSessionTTL time.Duration
	CredentialKey   [32]byte
	Now             func() time.Time
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
