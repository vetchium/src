package middleware

import (
	"context"
	"crypto/sha256"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
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

func HubAuth(s *hubapi.Server) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			credentials := strings.Fields(r.Header.Get("Authorization"))
			if len(credentials) != 2 ||
				!strings.EqualFold(credentials[0], "Bearer") {
				s.Problem(
					r.Context(), w, hubproblem.AuthenticationRequiredError,
					hubapi.BearerChallenge,
				)
				return
			}
			tokenHash := sha256.Sum256([]byte(credentials[1]))
			session, err := s.Queries.AuthenticateHubSession(
				r.Context(), tokenHash[:],
			)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					s.Problem(
						r.Context(), w,
						hubproblem.AuthenticationRequiredError,
						hubapi.BearerChallenge,
					)
					return
				}
				s.InternalError(r.Context(), w, "authenticate Hub session", err)
				return
			}
			identity := HubIdentity{
				UserDID:         session.HubUserDid,
				SessionID:       session.HubSessionID,
				AuthenticatedAt: session.AuthenticatedAt.Time,
			}
			ctx := context.WithValue(
				r.Context(), hubIdentityContextKey{}, identity,
			)
			w.Header().Set("Cache-Control", "no-store")
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func RequireRecentHubAuthentication(
	s *hubapi.Server, maximumAge time.Duration,
) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identity, ok := HubIdentityFromContext(r.Context())
			if !ok {
				s.Problem(
					r.Context(), w, hubproblem.AuthenticationRequiredError,
					hubapi.BearerChallenge,
				)
				return
			}
			if identity.AuthenticatedAt.Before(
				s.CurrentTime().Add(-maximumAge),
			) {
				s.Problem(
					r.Context(), w,
					hubproblem.RecentAuthenticationRequiredError,
					hubapi.BearerChallenge,
				)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func HubIdentityFromContext(ctx context.Context) (HubIdentity, bool) {
	identity, ok := ctx.Value(hubIdentityContextKey{}).(HubIdentity)
	return identity, ok
}
