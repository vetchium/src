package hub

import (
	"context"
	"time"

	coordinatorspec "github.com/vetchium/src/typespec/global-coordinator"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/hub/auth"
)

type ShortIDGenerator interface {
	GenerateShortID(context.Context) (coordinatorspec.ShortID, error)
}

type Server struct {
	*apiserver.Runtime
	Queries     sqlc.Querier
	Coordinator ShortIDGenerator

	// Values below come from the shared application config.
	TenantID         string
	SessionDurations apiserver.SessionDurations
	PublicBaseURL    string
	CredentialKey    [32]byte
	Now              func() time.Time
}

func (s *Server) CurrentTime() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

func (s *Server) CredentialSubkey(purpose string) [32]byte {
	return auth.DeriveCredentialSubkey(s.CredentialKey, purpose)
}

func (s *Server) HandlerRuntime() *apiserver.Runtime {
	return s.Runtime
}

func (s *Server) HandlerQueries() sqlc.Querier {
	return s.Queries
}

func (s *Server) EncryptIdempotency(plaintext []byte) ([]byte, error) {
	return credentials.Encrypt(s.CredentialSubkey("idempotency"), plaintext)
}

func (s *Server) DecryptIdempotency(ciphertext []byte) ([]byte, error) {
	return credentials.Decrypt(s.CredentialSubkey("idempotency"), ciphertext)
}

func (s *Server) SessionDuration(remembered bool) time.Duration {
	return s.SessionDurations.Duration(remembered)
}
