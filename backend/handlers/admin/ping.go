package admin

import (
	"encoding/json"
	"net/http"
	"time"

	"backend/internal/adminapi"
)

func Ping(s *adminapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var nonce string
		var databaseTime time.Time
		row := s.DB.QueryRow(
			r.Context(),
			`SELECT gen_random_uuid()::text, clock_timestamp()`,
		)
		if err := row.Scan(&nonce, &databaseTime); err != nil {
			s.InternalError(r.Context(), w, "query admin ping", err)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(struct {
			Portal       string    `json:"portal"`
			Tenant       string    `json:"tenant"`
			Nonce        string    `json:"nonce"`
			DatabaseTime time.Time `json:"database_time"`
		}{
			Portal:       "admin",
			Tenant:       s.TenantID,
			Nonce:        nonce,
			DatabaseTime: databaseTime,
		}); err != nil {
			s.ErrorContext(
				r.Context(), "encode admin ping response",
				"event", "response_encode_error",
				"error", err,
			)
		}
	}
}
