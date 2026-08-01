package org

import (
	"net/http"
	"time"

	"backend/internal/httpx"
	"backend/internal/orgsapi"
)

func Ping(s *orgsapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var nonce string
		var databaseTime time.Time
		if err := s.DB.QueryRow(r.Context(), `SELECT gen_random_uuid()::text, clock_timestamp()`).Scan(&nonce, &databaseTime); err != nil {
			s.Log.ErrorContext(r.Context(), "org ping failed", "error", err)
			httpx.WriteProblem(w, http.StatusInternalServerError, "The request could not be completed.")
			return
		}

		_ = httpx.WriteJSON(w, http.StatusOK, struct {
			Portal       string    `json:"portal"`
			Tenant       string    `json:"tenant"`
			Nonce        string    `json:"nonce"`
			DatabaseTime time.Time `json:"database_time"`
		}{
			Portal:       "org",
			Tenant:       s.TenantID,
			Nonce:        nonce,
			DatabaseTime: databaseTime,
		})
	}
}
