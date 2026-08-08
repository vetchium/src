package mesh

import (
	"encoding/json"
	"net/http"

	"backend/internal/meshapi"
)

func Sync(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// TODO: authenticate the calling tenant.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		if err := json.NewEncoder(w).Encode(map[string]string{
			"status": "accepted",
			"tenant": s.TenantID,
		}); err != nil {
			s.ErrorContext(r.Context(), "encode mesh sync response", "event", "response_encode_error", "error", err)
		}
	}
}
