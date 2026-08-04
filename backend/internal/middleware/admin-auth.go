package middleware

import (
	"context"
	"crypto/sha256"
	"errors"
	"net/http"
	"strings"

	"backend/internal/adminapi"

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
			credentials := strings.Fields(r.Header.Get("Authorization"))
			if len(credentials) != 2 ||
				!strings.EqualFold(credentials[0], "Bearer") {
				s.Unauthorized(w)
				return
			}
			tokenHash := sha256.Sum256([]byte(credentials[1]))

			session, err := s.Queries.AuthenticateAdminSession(r.Context(), tokenHash[:])
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					s.Unauthorized(w)
					return
				}
				s.ErrorContext(r.Context(), "authenticate admin", "error", err)
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
