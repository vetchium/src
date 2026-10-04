package orgs

import (
	"context"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	directoryspec "github.com/vetchium/src/typespec/directory"
	subscriptionspec "github.com/vetchium/src/typespec/orgs/subscriptions"
	"github.com/vetchium/src/typespec/problem"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/imagesanitize"
	"backend/internal/oidc"
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
	// AllowSpecialUseDomains admits signups for names such as acme.test.
	AllowSpecialUseDomains bool

	// Values below come from the shared application config.
	TenantID      string
	SessionTTL    time.Duration
	SignupTTL     time.Duration
	InvitationTTL time.Duration
	PublicBaseURL string
	CredentialKey [32]byte
	Now           func() time.Time

	// OfferedPlans are the plans available in this tenant.
	OfferedPlans []subscriptionspec.Plan

	// Logos is the tenant's object store for Org logos.
	Logos LogoStorage

	// GoogleSignIn is nil when the tenant does not offer Google sign-in.
	GoogleSignIn SSOProvider
}

// SSOProvider is the OpenID Connect client for one identity provider.
type SSOProvider interface {
	NewVerifier() string
	AuthorizationURL(
		ctx context.Context, state, nonce, verifier, hostedDomain string,
	) (string, error)
	Exchange(ctx context.Context, code, verifier string) (oidc.Claims, error)
}

// LogoStorage stores Org logos and signs short-lived read URLs for them.
type LogoStorage interface {
	PutLogo(context.Context, pgtype.UUID, imagesanitize.Image) error
	DeleteLogo(context.Context, pgtype.UUID) error
	SignLogoGet(context.Context, pgtype.UUID) (string, error)
}

// Offers reports whether this tenant offers plan.
func (s *Server) Offers(plan subscriptionspec.Plan) bool {
	return slices.Contains(s.OfferedPlans, plan)
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
