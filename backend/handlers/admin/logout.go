package admin

import (
	"net/http"

	"backend/internal/auth"
	"backend/internal/httpx"
	"backend/internal/middleware"
	"backend/internal/server"
)

func Logout(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		identity, ok := middleware.AdminIdentityFromContext(r.Context())
		if !ok {
			httpx.WriteBearerProblem(w, auth.AdminBearerRealm, auth.ProblemTypeAuthenticationNeeded, "Authentication required", "Authentication is required.")
			return
		}

		deleted, err := s.AdminDB.DeleteAdminSession(r.Context(), identity.SessionTokenHash)
		if err != nil {
			adminLogger(s).ErrorContext(r.Context(), "delete admin session", "error", err)
			httpx.WriteProblem(w, http.StatusInternalServerError, "The request could not be completed.")
			return
		}
		if deleted == 0 {
			httpx.WriteBearerProblem(w, auth.AdminBearerRealm, auth.ProblemTypeInvalidSession, "Invalid session", "The session is no longer valid.")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
