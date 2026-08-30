package hub

import (
	"net/http"
	"strings"

	"backend/internal/credentials"
	"backend/internal/db/sqlc"
	"backend/internal/hubapi"
)

func Logout(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bearer := strings.Fields(r.Header.Get("Authorization"))
		if len(bearer) == 2 &&
			strings.EqualFold(bearer[0], "Bearer") {
			err := s.Queries.DeleteHubSessionByTokenHash(
				r.Context(), sqlc.DeleteHubSessionByTokenHashParams{
					SessionTokenHash: credentials.TokenHash(bearer[1]),
					TenantID:         s.TenantID,
				},
			)
			if err != nil {
				s.InternalError(r.Context(), w, "delete Hub session", err)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		s.Empty(r.Context(), w, http.StatusNoContent)
	}
}
