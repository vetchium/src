package health

import (
	"log/slog"
	"net/http"

	"backend/internal/httpx"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vetchium/src/typespec/problem"
)

func Ready(db *pgxpool.Pool, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := db.Ping(r.Context()); err != nil {
			log.ErrorContext(r.Context(), "readiness check failed", "error", err)
			httpx.WriteProblem(w, problem.New(http.StatusServiceUnavailable, "The database is unreachable."))
			return
		}
		_ = httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ready"})
	}
}
