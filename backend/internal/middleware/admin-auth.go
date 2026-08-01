package middleware

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"backend/internal/auth"
	"backend/internal/db/sqlc"
	"backend/internal/server"
	"github.com/jackc/pgx/v5"
)

type adminIdentityContextKey struct{}

type AdminIdentity struct {
	UserID           string
	EmailAddress     string
	DisplayName      string
	AdminUserState   sqlc.VetchiumAdminUserState
	Admin            sqlc.GetAuthenticatedAdminRow
	SessionTokenHash []byte
}

func AdminAuth(s *server.Server) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			log := s.Log
			if log == nil {
				log = slog.Default()
			}

			token, ok := auth.BearerToken(r.Header.Get("Authorization"))
			if !ok {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}

			admin, err := s.AdminDB.GetAuthenticatedAdmin(r.Context(), auth.HashSessionToken(token))
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					w.WriteHeader(http.StatusUnauthorized)
					return
				}
				log.ErrorContext(r.Context(), "authenticate admin session", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}

			identity := AdminIdentity{
				UserID:           admin.AdminUserID.String(),
				EmailAddress:     admin.EmailAddress,
				DisplayName:      admin.DisplayName,
				AdminUserState:   admin.AdminUserState,
				Admin:            admin,
				SessionTokenHash: append([]byte(nil), admin.SessionTokenHash...),
			}
			ctx := context.WithValue(r.Context(), adminIdentityContextKey{}, identity)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func AdminIdentityFromContext(ctx context.Context) (AdminIdentity, bool) {
	identity, ok := ctx.Value(adminIdentityContextKey{}).(AdminIdentity)
	return identity, ok
}
