package middleware

import (
	"context"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	orgsauthorization "github.com/vetchium/src/typespec/orgs/authorization"
	orgsproblem "github.com/vetchium/src/typespec/problem/orgs"

	"backend/internal/db/sqlc"
	orgsruntime "backend/internal/orgs"
	orgsauthn "backend/internal/orgs/auth"
)

type orgIdentityContextKey struct{}

type OrgIdentity struct {
	UserID          pgtype.UUID
	OrgDID          pgtype.UUID
	SessionID       pgtype.UUID
	AuthenticatedAt time.Time
	// Suspended and Permissions are read from the database on every request,
	// so a grant, revocation, or suspension applies to the next request
	// without a new sign-in.
	Suspended   bool
	Permissions []string
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
				Suspended: session.OrgState ==
					sqlc.VetchiumOrgStateSuspended,
				Permissions: session.Permissions,
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

// RequireOrgPermission refuses a user whose effective permissions, which
// include those implied by a grant, lack permission.
func RequireOrgPermission(
	s *orgsruntime.Server, permission orgsauthorization.OrgPermission,
) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identity, ok := OrgIdentityFromContext(r.Context())
			if !ok {
				s.AuthenticationProblem(
					r.Context(), w, orgsproblem.AuthenticationRequiredError,
					orgsauthn.BearerChallenge,
				)
				return
			}
			if !slices.Contains(identity.Permissions, string(permission)) {
				s.Problem(r.Context(), w, orgsproblem.PermissionRequiredError)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireActiveOrg refuses every operation of a suspended Org. Compose it on
// each route except the account and billing routes a suspended Org keeps
// (agent-guides/orgs.md, Suspended Orgs).
func RequireActiveOrg(
	s *orgsruntime.Server,
) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identity, ok := OrgIdentityFromContext(r.Context())
			if !ok {
				s.AuthenticationProblem(
					r.Context(), w, orgsproblem.AuthenticationRequiredError,
					orgsauthn.BearerChallenge,
				)
				return
			}
			if identity.Suspended {
				s.Problem(r.Context(), w, orgsproblem.OrgSuspendedError)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func OrgIdentityFromContext(ctx context.Context) (OrgIdentity, bool) {
	identity, ok := ctx.Value(orgIdentityContextKey{}).(OrgIdentity)
	return identity, ok
}
