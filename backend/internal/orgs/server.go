package orgs

import (
	"context"
	"time"

	directoryspec "github.com/vetchium/src/typespec/directory"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/orgs/auth"
	"backend/internal/orgs/domainverification"
	"backend/internal/orgs/signupcompletion"
	"backend/internal/regions"
)

// Directory is the part of the global directory orgs-api reads directly;
// commands go through the signup and domain-verification services.
type Directory interface {
	ResolveOrgDomain(
		context.Context, directoryspec.ResolveOrgDomainRequest,
	) (directoryspec.ResolveOrgDomainResponse, *problem.Details, error)
}

type Server struct {
	*apiserver.Runtime
	Queries          sqlc.Querier
	Directory        Directory
	Regions          *regions.Catalog
	SignupCompletion *signupcompletion.Service
	Domains          *domainverification.Service
	Signup           regions.Admission

	// Values below come from the shared application config.
	TenantID      string
	SessionTTL    time.Duration
	SignupTTL     time.Duration
	PublicBaseURL string
	CredentialKey [32]byte
	Now           func() time.Time
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

func (s *Server) SessionDurations() apiserver.SessionDurations {
	return apiserver.SessionDurations{Default: s.SessionTTL}
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
