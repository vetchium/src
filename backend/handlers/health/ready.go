package health

import (
	"encoding/json"
	"net/http"

	"backend/internal/server"
)

func Ready(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if err := s.DB.Ping(r.Context()); err != nil {
			s.Log.ErrorContext(r.Context(), "readiness check failed", "error", err)
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"status": "unavailable",
				"reason": "database unreachable",
			})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
	}
}
