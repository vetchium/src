package mesh

import (
	"net/http"

	"backend/internal/meshapi"
)

func Sync(s *meshapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// TODO: authenticate the calling tenant.
		s.JSON(r.Context(), w, http.StatusAccepted, map[string]string{
			"status": "accepted",
			"tenant": s.TenantID,
		})
	}
}
