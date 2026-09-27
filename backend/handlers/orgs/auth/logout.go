package auth

import (
	"net/http"
	"strings"

	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	orgsruntime "backend/internal/orgs"
)

func Logout(s *orgsruntime.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bearer := strings.Fields(r.Header.Get("Authorization"))
		if len(bearer) == 2 && strings.EqualFold(bearer[0], "Bearer") {
			err := s.Queries.DeleteOrgSessionByTokenHash(
				r.Context(), sqlc.DeleteOrgSessionByTokenHashParams{
					SessionTokenHash: credentials.TokenHash(bearer[1]),
					TenantID:         s.TenantID,
				},
			)
			if err != nil {
				s.InternalError(r.Context(), w, "delete Org session", err)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		s.Empty(r.Context(), w, http.StatusNoContent)
	}
}
