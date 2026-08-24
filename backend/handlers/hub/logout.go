package hub

import (
	"net/http"
	"strings"

	"backend/internal/db/sqlc"
	"backend/internal/hubapi"
)

func Logout(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		credentials := strings.Fields(r.Header.Get("Authorization"))
		if len(credentials) == 2 &&
			strings.EqualFold(credentials[0], "Bearer") {
			err := s.Queries.DeleteHubSessionByTokenHash(
				r.Context(), sqlc.DeleteHubSessionByTokenHashParams{
					SessionTokenHash: hubapi.TokenHash(credentials[1]),
					TenantID:         s.TenantID,
				},
			)
			if err != nil {
				s.InternalError(r.Context(), w, "delete Hub session", err)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
	}
}
