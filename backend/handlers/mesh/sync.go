package mesh

import (
	"encoding/json"
	"net/http"

	"backend/internal/meshapi"
)

func Sync(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		// TODO: authenticate the calling tenant.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status": "accepted",
			"tenant": s.TenantID,
		})
	}
}
