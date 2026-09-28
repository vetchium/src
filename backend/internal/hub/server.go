package hub

import (
	"context"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	subscriptionspec "github.com/vetchium/src/typespec/hub/subscriptions"

	"backend/internal/apiserver"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/directoryclient"
	"backend/internal/hub/auth"
	"backend/internal/hub/emailchange"
	"backend/internal/hub/professionalemail"
	"backend/internal/hub/signupcompletion"
	"backend/internal/profileclient"
	"backend/internal/profilepicture"
	"backend/internal/regions"
)

type PictureStorage interface {
	Put(context.Context, pgtype.UUID, profilepicture.Sanitized) error
}

// AccountEmailDigester is satisfied structurally by identitydigest.Key. This
// package must never import backend/internal/identitydigest directly: it is
// reachable from backend/internal/routes (hub_routes.go), which
// global-coordinator and mesh-api also import for their own unrelated
// routes, and identitydigest must never be linked into those binaries
// (GU-KEY-002). Only backend/cmd/hub-api constructs the concrete key.
//
// It covers both digest namespaces (account and professional email):
// handlers reach it as s.DigestKey for both CreateHubProfessionalEmail
// (GU-PEM-001) and the account-email paths, so one field suffices.
type AccountEmailDigester interface {
	HubAccountEmail(address string) []byte
	HubProfessionalEmail(address string) []byte
	ID() string
}

type Server struct {
	*apiserver.Runtime
	Regions           *regions.Catalog
	RegionDirectory   regions.Directory
	Directory         *directoryclient.Client
	Profiles          *profileclient.Client
	Pictures          PictureStorage
	SignupCompletion  *signupcompletion.Service
	EmailChange       *emailchange.Service
	ProfessionalEmail *professionalemail.Service
	Signup            regions.Admission
	Queries           sqlc.Querier
	// DigestKey computes the keyed digests the global directory holds claims
	// for (GU-CFG-002); it never leaves hub-api and workers.
	DigestKey AccountEmailDigester

	// Values below come from the shared application config.
	TenantID         string
	SessionDurations apiserver.SessionDurations
	PublicBaseURL    string
	CredentialKey    [32]byte
	OfferedPlans     []subscriptionspec.Plan
	Now              func() time.Time
}

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
