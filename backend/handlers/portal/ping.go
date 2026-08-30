// Package portal provides handlers shared by tenant portal APIs.
package portal

import (
	"context"
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

		runtime.JSON(r.Context(), w, http.StatusOK, struct {
			Portal       string    `json:"portal"`
			Tenant       string    `json:"tenant"`
			Nonce        string    `json:"nonce"`
			DatabaseTime time.Time `json:"database_time"`
		}{
			Portal:       portal,
			Tenant:       tenant,
			Nonce:        row.Nonce,
			DatabaseTime: row.DatabaseTime.Time.UTC(),
		})
	}
}
