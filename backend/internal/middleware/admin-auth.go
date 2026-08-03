package middleware

import (
	"context"
	"errors"
	"net/http"

	"backend/internal/adminapi"
	"backend/internal/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type adminIdentityContextKey struct{}

type AdminIdentity struct {
	UserID    pgtype.UUID
	SessionID pgtype.UUID
}

func AdminAuth(s *adminapi.Server) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, ok := auth.BearerToken(r.Header.Get("Authorization"))
			if !ok {
				auth.Unauthorized(w)
				return
			}

			session, err := s.Queries.AuthenticateAdminSession(r.Context(), auth.HashSessionToken(token))
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					auth.Unauthorized(w)
					return
				}
				s.ErrorContext(r.Context(), "authenticate admin session", "error", err)
				s.InternalError(w)
				return
			}

			identity := AdminIdentity{
				UserID:    session.AdminUserID,
				SessionID: session.AdminSessionID,
			}
			ctx := context.WithValue(r.Context(), adminIdentityContextKey{}, identity)
			w.Header().Set("Cache-Control", "no-store")
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func AdminIdentityFromContext(ctx context.Context) (AdminIdentity, bool) {
	identity, ok := ctx.Value(adminIdentityContextKey{}).(AdminIdentity)
	return identity, ok
}
