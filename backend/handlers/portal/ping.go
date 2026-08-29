// Package portal provides handlers shared by tenant portal APIs.
package portal

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"backend/internal/apiserver"
	"backend/internal/db/sqlc"
)

type pingQueries interface {
	PingDatabase(context.Context) (sqlc.PingDatabaseRow, error)
}

func Ping(
	runtime *apiserver.Runtime, queries pingQueries, portal, tenant string,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		row, err := queries.PingDatabase(r.Context())
		if err != nil {
			runtime.InternalError(r.Context(), w, "query "+portal+" ping", err)
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
			Portal:       portal,
			Tenant:       tenant,
			Nonce:        row.Nonce,
			DatabaseTime: row.DatabaseTime.Time.UTC(),
		}); err != nil {
			runtime.ErrorContext(
				r.Context(), "encode "+portal+" ping response",
				"event", "response_encode_error",
				"error", err,
			)
		}
	}
}
