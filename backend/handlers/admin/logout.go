package admin

import (
	"net/http"
	"strings"

	"backend/internal/adminapi"
	"backend/internal/credentials"
	"backend/internal/db/sqlc"
)

func Logout(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bearer := strings.Fields(r.Header.Get("Authorization"))
		if len(bearer) == 2 &&
			strings.EqualFold(bearer[0], "Bearer") {
			_, err := s.Queries.DeleteAdminSessionByTokenHash(
				r.Context(), sqlc.DeleteAdminSessionByTokenHashParams{
					SessionTokenHash: credentials.TokenHash(bearer[1]),
					TenantID:         s.TenantID,
				},
			)
			if err != nil {
				s.InternalError(r.Context(), w, "delete admin session", err)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		s.Empty(r.Context(), w, http.StatusNoContent)
	}
}
