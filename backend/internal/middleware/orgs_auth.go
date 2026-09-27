package middleware

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	orgsruntime "backend/internal/orgs"
	orgsauthn "backend/internal/orgs/auth"
)

type orgIdentityContextKey struct{}

type OrgIdentity struct {
	UserID          pgtype.UUID
	OrgDID          pgtype.UUID
	SessionID       pgtype.UUID
	AuthenticatedAt time.Time
}

func orgAuthentication(
	s *orgsruntime.Server,
) PortalAuthentication[OrgIdentity] {
	return PortalAuthentication[OrgIdentity]{
		Runtime:                      s.Runtime,
		Portal:                       "orgs",
		Challenge:                    orgsauthn.BearerChallenge,
		AuthenticationRequired:       orgsproblem.AuthenticationRequiredError,
		RecentAuthenticationRequired: orgsproblem.RecentAuthenticationRequiredError,
		Authenticate: func(
			ctx context.Context, tokenHash []byte,
		) (OrgIdentity, error) {
			session, err := s.Queries.AuthenticateOrgSession(ctx, tokenHash)
			if err != nil {
				return OrgIdentity{}, err
			}
			return OrgIdentity{
				UserID:          session.OrgUserID,
				OrgDID:          session.OrgDid,
				SessionID:       session.OrgSessionID,
				AuthenticatedAt: session.AuthenticatedAt.Time,
			}, nil
		},
		AuthenticatedAt: func(identity OrgIdentity) time.Time {
			return identity.AuthenticatedAt
		},
		Store: func(
			ctx context.Context, identity OrgIdentity,
		) context.Context {
			return context.WithValue(ctx, orgIdentityContextKey{}, identity)
		},
		Load: OrgIdentityFromContext,
		Now:  s.CurrentTime,
	}
}

func OrgAuth(s *orgsruntime.Server) func(http.Handler) http.Handler {
	return orgAuthentication(s).Session()
}

func RequireRecentOrgAuthentication(
	s *orgsruntime.Server, maximumAge time.Duration,
) func(http.Handler) http.Handler {
	return orgAuthentication(s).RequireRecentAuthentication(maximumAge)
}

func OrgIdentityFromContext(ctx context.Context) (OrgIdentity, bool) {
	identity, ok := ctx.Value(orgIdentityContextKey{}).(OrgIdentity)
	return identity, ok
}
