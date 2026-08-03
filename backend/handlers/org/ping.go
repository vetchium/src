package org

import (
	"encoding/json"
	"net/http"
	"time"

	"backend/internal/orgsapi"
	problemspec "github.com/vetchium/src/typespec/problem"
)

func Ping(s *orgsapi.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var nonce string
		var databaseTime time.Time
		if err := s.DB.QueryRow(r.Context(), `SELECT gen_random_uuid()::text, clock_timestamp()`).Scan(&nonce, &databaseTime); err != nil {
			s.ErrorContext(r.Context(), "org ping failed", "error", err)
			w.Header().Set("Content-Type", problemspec.MediaType)
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(problemspec.InternalServerErrorBody))
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(struct {
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
