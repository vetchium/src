package apiserver

import (
	"log/slog"
	"net/http"

	"backend/internal/httpx"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vetchium/src/typespec/problem"
)

// Runtime contains dependencies and behavior shared by every API server.
type Runtime struct {
	*slog.Logger
	DB *pgxpool.Pool
}

func New(db *pgxpool.Pool, logger *slog.Logger) *Runtime {
	return &Runtime{DB: db, Logger: logger}
}

func (s *Runtime) Ready(w http.ResponseWriter, r *http.Request) {
	if err := s.DB.Ping(r.Context()); err != nil {
		s.ErrorContext(r.Context(), "readiness check failed", "error", err)
		httpx.WriteProblem(w, problem.New(http.StatusServiceUnavailable, "The database is unreachable."))
		return
	}
	_ = httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}
