package hub

import (
	"net/http"
	"time"

	"backend/internal/httpx"
	"backend/internal/hubapi"
	"github.com/vetchium/src/typespec/problem"
)

func Ping(s *hubapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var nonce string
		var databaseTime time.Time
		if err := s.DB.QueryRow(r.Context(), `SELECT gen_random_uuid()::text, clock_timestamp()`).Scan(&nonce, &databaseTime); err != nil {
			s.Log.ErrorContext(r.Context(), "hub ping failed", "error", err)
			httpx.WriteProblem(w, problem.NewInternalServerError())
			return
		}

		_ = httpx.WriteJSON(w, http.StatusOK, struct {
			Portal       string    `json:"portal"`
			Tenant       string    `json:"tenant"`
			Nonce        string    `json:"nonce"`
			DatabaseTime time.Time `json:"database_time"`
		}{
			Portal:       "hub",
			Tenant:       s.TenantID,
			Nonce:        nonce,
			DatabaseTime: databaseTime,
		})
	}
}
