package middleware

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	hubproblem "github.com/vetchium/src/typespec/problem/hub"

	"backend/internal/hubapi"
)

type hubIdentityContextKey struct{}

type HubIdentity struct {
	UserDID         pgtype.UUID
	SessionID       pgtype.UUID
	AuthenticatedAt time.Time
}

func hubAuthentication(s *hubapi.Server) PortalAuthentication[HubIdentity] {
	return PortalAuthentication[HubIdentity]{
		Runtime:                      s.Runtime,
		Portal:                       "hub",
		Challenge:                    hubapi.BearerChallenge,
		AuthenticationRequired:       hubproblem.AuthenticationRequiredError,
		RecentAuthenticationRequired: hubproblem.RecentAuthenticationRequiredError,
		Authenticate: func(
			ctx context.Context, tokenHash []byte,
		) (HubIdentity, error) {
			session, err := s.Queries.AuthenticateHubSession(ctx, tokenHash)
			if err != nil {
				return HubIdentity{}, err
			}
			return HubIdentity{
				UserDID:         session.HubUserDid,
				SessionID:       session.HubSessionID,
				AuthenticatedAt: session.AuthenticatedAt.Time,
			}, nil
		},
		AuthenticatedAt: func(identity HubIdentity) time.Time {
			return identity.AuthenticatedAt
		},
		Store: func(
			ctx context.Context, identity HubIdentity,
		) context.Context {
			return context.WithValue(ctx, hubIdentityContextKey{}, identity)
		},
		Load: HubIdentityFromContext,
		Now:  s.CurrentTime,
	}
}

func HubAuth(s *hubapi.Server) func(http.Handler) http.Handler {
	return hubAuthentication(s).Session()
}

func RequireRecentHubAuthentication(
	s *hubapi.Server, maximumAge time.Duration,
) func(http.Handler) http.Handler {
	return hubAuthentication(s).RequireRecentAuthentication(maximumAge)
}

func HubIdentityFromContext(ctx context.Context) (HubIdentity, bool) {
	identity, ok := ctx.Value(hubIdentityContextKey{}).(HubIdentity)
	return identity, ok
}
