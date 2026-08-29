package middleware

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	adminproblem "github.com/vetchium/src/typespec/problem/admin"

	"backend/internal/adminapi"
)

type adminIdentityContextKey struct{}

type AdminIdentity struct {
	UserID          pgtype.UUID
	SessionID       pgtype.UUID
	AuthenticatedAt time.Time
	Permissions     []string
}

func adminAuthentication(
	s *adminapi.Server,
) PortalAuthentication[AdminIdentity] {
	return PortalAuthentication[AdminIdentity]{
		Runtime:                      s.Runtime,
		Portal:                       "admin",
		Challenge:                    adminapi.BearerChallenge,
		AuthenticationRequired:       adminproblem.AdminAuthenticationRequiredError,
		RecentAuthenticationRequired: adminproblem.RecentAuthenticationRequiredError,
		Authenticate: func(
			ctx context.Context, tokenHash []byte,
		) (AdminIdentity, error) {
			session, err := s.Queries.AuthenticateAdminSession(ctx, tokenHash)
			if err != nil {
				return AdminIdentity{}, err
			}
			return AdminIdentity{
				UserID:          session.AdminUserID,
				SessionID:       session.AdminSessionID,
				AuthenticatedAt: session.AuthenticatedAt.Time,
				Permissions:     session.Permissions,
			}, nil
		},
		AuthenticatedAt: func(identity AdminIdentity) time.Time {
			return identity.AuthenticatedAt
		},
		Store: func(
			ctx context.Context, identity AdminIdentity,
		) context.Context {
			return context.WithValue(ctx, adminIdentityContextKey{}, identity)
		},
		Load: AdminIdentityFromContext,
		Now:  s.CurrentTime,
	}
}

func AdminAuth(s *adminapi.Server) func(http.Handler) http.Handler {
	return adminAuthentication(s).Session()
}

func RequireRecentAdminAuthentication(
	s *adminapi.Server, maximumAge time.Duration,
) func(http.Handler) http.Handler {
	return adminAuthentication(s).RequireRecentAuthentication(maximumAge)
}

func RequireAdminPermission(
	s *adminapi.Server, permission string,
) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			identity, ok := AdminIdentityFromContext(r.Context())
			if !ok {
				s.Problem(
					r.Context(), w,
					adminproblem.AdminAuthenticationRequiredError,
					adminapi.BearerChallenge,
				)
				return
			}
			if !containsPermission(identity.Permissions, permission) {
				s.Problem(
					r.Context(), w,
					adminproblem.AdminPermissionRequiredError,
				)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func containsPermission(permissions []string, wanted string) bool {
	for _, permission := range permissions {
		if permission == wanted {
			return true
		}
	}
	return false
}

func AdminIdentityFromContext(ctx context.Context) (AdminIdentity, bool) {
	identity, ok := ctx.Value(adminIdentityContextKey{}).(AdminIdentity)
	return identity, ok
}
