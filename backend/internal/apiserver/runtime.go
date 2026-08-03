package apiserver

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	problemspec "github.com/vetchium/src/typespec/problem"
)

const databaseUnavailableBody = `{"type":"about:blank","title":"Service Unavailable","status":503,"detail":"The database is unreachable."}`

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
		w.Header().Set("Content-Type", problemspec.MediaType)
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(databaseUnavailableBody))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ready"})
}
