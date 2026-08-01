package health

import (
	"net/http"

	"backend/internal/httpx"
	"backend/internal/server"
)

func Ready(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := s.DB.Ping(r.Context()); err != nil {
			s.Log.ErrorContext(r.Context(), "readiness check failed", "error", err)
			httpx.WriteProblem(w, http.StatusServiceUnavailable, "The database is unreachable.")
			return
		}
		_ = httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	}
}
