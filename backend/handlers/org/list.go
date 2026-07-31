package org

import (
	"encoding/json"
	"net/http"

	"backend/internal/server"
)

type organization struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

func List(s *server.Server) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.DB.Query(r.Context(), `SELECT id, name FROM orgs ORDER BY id`)
		if err != nil {
			s.Log.ErrorContext(r.Context(), "failed to list orgs", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		orgs := make([]organization, 0)
		for rows.Next() {
			var item organization
			if err := rows.Scan(&item.ID, &item.Name); err != nil {
				s.Log.ErrorContext(r.Context(), "failed to scan org", "error", err)
				http.Error(w, "", http.StatusInternalServerError)
				return
			}
			orgs = append(orgs, item)
		}
		if err := rows.Err(); err != nil {
			s.Log.ErrorContext(r.Context(), "failed to read orgs", "error", err)
			http.Error(w, "", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(struct {
			Tenant string         `json:"tenant"`
			Orgs   []organization `json:"orgs"`
		}{Tenant: s.TenantID, Orgs: orgs})
	}
}
