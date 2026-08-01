package admin

import (
	"net/http"

	"backend/internal/middleware"
	"backend/internal/server"
)

func Logout(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, ok := middleware.AdminIdentityFromContext(r.Context())
		if !ok {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		deleted, err := s.AdminDB.DeleteAdminSession(r.Context(), identity.SessionTokenHash)
		if err != nil {
			adminLogger(s).ErrorContext(r.Context(), "delete admin session", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		if deleted == 0 {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
