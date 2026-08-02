package middleware

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"backend/internal/adminapi"
	"backend/internal/auth"
	"backend/internal/httpx"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vetchium/src/typespec/problem"
)

type adminIdentityContextKey struct{}

type AdminIdentity struct {
	UserID    pgtype.UUID
	SessionID pgtype.UUID
}

func AdminAuth(s *adminapi.Server) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			log := s.Log
			if log == nil {
				log = slog.Default()
			}

			token, ok := auth.BearerToken(r.Header.Get("Authorization"))
			if !ok {
				writeUnauthorized(w, problem.NewAuthenticationRequired("A valid bearer token is required."))
				return
			}

			session, err := s.Queries.AuthenticateAdminSession(r.Context(), auth.HashSessionToken(token))
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					writeUnauthorized(w, problem.NewInvalidSession("The bearer token is invalid or expired."))
					return
				}
				log.ErrorContext(r.Context(), "authenticate admin session", "error", err)
				httpx.WriteProblem(w, problem.NewInternalServerError())
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

func writeUnauthorized(w http.ResponseWriter, details problem.Details) {
	httpx.WriteBearerProblem(w, auth.AdminBearerRealm, details)
}

func AdminIdentityFromContext(ctx context.Context) (AdminIdentity, bool) {
	identity, ok := ctx.Value(adminIdentityContextKey{}).(AdminIdentity)
	return identity, ok
}
