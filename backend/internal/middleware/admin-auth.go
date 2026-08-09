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

	adminproblem "github.com/vetchium/src/typespec/problem/admin"

	"backend/internal/adminapi"
)

type adminIdentityContextKey struct{}

type AdminIdentity struct {
	UserID          pgtype.UUID
	SessionID       pgtype.UUID
	AuthenticatedAt time.Time
	IsSuperadmin    bool
	Permissions     []string
}

func AdminAuth(s *adminapi.Server) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()
			authorization := r.Header.Get("Authorization")
			credentials := strings.Fields(authorization)
			if len(credentials) != 2 || !strings.EqualFold(credentials[0], "Bearer") {
				s.Problem(
					ctx, w, adminproblem.AdminAuthenticationRequiredError,
					adminapi.BearerChallenge,
				)
				return
			}
			tokenHash := sha256.Sum256([]byte(credentials[1]))

			session, err := s.Queries.AuthenticateAdminSession(ctx, tokenHash[:])
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					s.WarnContext(
						ctx, "admin authentication failed",
						"event", "authentication_failed",
						"reason", "session_not_found",
						"error", err,
					)
					s.Problem(
						ctx, w,
						adminproblem.AdminAuthenticationRequiredError,
						adminapi.BearerChallenge,
					)
					return
				}
				s.InternalError(ctx, w, "authenticate admin", err)
				return
			}

			identity := AdminIdentity{
				UserID:          session.AdminUserID,
				SessionID:       session.AdminSessionID,
				AuthenticatedAt: session.AuthenticatedAt.Time,
				IsSuperadmin:    session.IsSuperadmin,
				Permissions:     session.Permissions,
			}
			ctx = context.WithValue(ctx, adminIdentityContextKey{}, identity)
			w.Header().Set("Cache-Control", "no-store")
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
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
			if !identity.IsSuperadmin &&
				!containsPermission(identity.Permissions, permission) {
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

func RequireSuperadmin(s *adminapi.Server) func(http.Handler) http.Handler {
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
			if !identity.IsSuperadmin {
				s.Problem(
					r.Context(), w, adminproblem.SuperadminRequiredError,
				)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func RequireRecentAdminAuthentication(
	s *adminapi.Server, maximumAge time.Duration,
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
			if identity.AuthenticatedAt.Before(
				s.CurrentTime().Add(-maximumAge),
			) {
				s.Problem(
					r.Context(), w,
					adminproblem.RecentAuthenticationRequiredError,
					adminapi.BearerChallenge,
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
