package admin

import (
	"net/http"
	"strings"

	"backend/internal/adminapi"
	"backend/internal/db/sqlc"
)

func Logout(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		credentials := strings.Fields(r.Header.Get("Authorization"))
		if len(credentials) == 2 &&
			strings.EqualFold(credentials[0], "Bearer") {
			_, err := s.Queries.DeleteAdminSessionByTokenHash(
				r.Context(), sqlc.DeleteAdminSessionByTokenHashParams{
					SessionTokenHash: adminapi.TokenHash(credentials[1]),
					TenantID:         s.TenantID,
				},
			)
			if err != nil {
				s.InternalError(r.Context(), w, "delete admin session", err)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusNoContent)
	}
}
