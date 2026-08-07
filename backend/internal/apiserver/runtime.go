package apiserver

import (
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Runtime contains dependencies and behavior shared by every API server.
type Runtime struct {
	*slog.Logger
	DB *pgxpool.Pool
}

func New(db *pgxpool.Pool, logger *slog.Logger) *Runtime {
	return &Runtime{DB: db, Logger: logger}
}
