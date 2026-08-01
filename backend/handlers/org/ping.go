package org

import (
	"encoding/json"
	"net/http"
	"time"

	"backend/internal/server"
)

func Ping(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var nonce string
		var databaseTime time.Time
		if err := s.DB.QueryRow(r.Context(), `SELECT gen_random_uuid()::text, clock_timestamp()`).Scan(&nonce, &databaseTime); err != nil {
			s.Log.ErrorContext(r.Context(), "org ping failed", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
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
