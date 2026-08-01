package middleware

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"backend/internal/auth"
	"backend/internal/db/sqlc"
	"backend/internal/httpx"
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
				writeUnauthorized(w, auth.ProblemTypeAuthenticationNeeded, "Authentication required", "A valid bearer token is required.")
				return
			}

			admin, err := s.AdminDB.GetAuthenticatedAdmin(r.Context(), auth.HashSessionToken(token))
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					writeUnauthorized(w, auth.ProblemTypeInvalidSession, "Invalid session", "The bearer token is invalid or expired.")
					return
				}
				log.ErrorContext(r.Context(), "authenticate admin session", "error", err)
				httpx.WriteProblem(w, http.StatusInternalServerError, "The request could not be completed.")
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
			w.Header().Set("Cache-Control", "no-store")
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func writeUnauthorized(w http.ResponseWriter, typeURI, title, detail string) {
	httpx.WriteBearerProblem(w, auth.AdminBearerRealm, typeURI, title, detail)
}

func AdminIdentityFromContext(ctx context.Context) (AdminIdentity, bool) {
	identity, ok := ctx.Value(adminIdentityContextKey{}).(AdminIdentity)
	return identity, ok
}
