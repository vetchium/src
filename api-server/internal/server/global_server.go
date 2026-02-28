package server

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"vetchium-api-server.gomodule/internal/db/globaldb"
	"vetchium-api-server.gomodule/internal/middleware"
)

// GlobalServer holds dependencies for the global service (admin HTTP handlers).
// It connects only to the global database - no regional DB access.
type GlobalServer struct {
	Global     *globaldb.Queries
	GlobalPool *pgxpool.Pool

	Log           *slog.Logger
	TokenConfig   *TokenConfig
	UIConfig      *UIConfig
	Environment   string
	StorageConfig *StorageConfig
}

// Logger returns the logger from context with request ID, or falls back to base logger.
func (s *GlobalServer) Logger(ctx context.Context) *slog.Logger {
	return middleware.LoggerFromContext(ctx, s.Log)
}

// WithGlobalTx executes a function within a global database transaction.
func (s *GlobalServer) WithGlobalTx(ctx context.Context, fn func(*globaldb.Queries) error) error {
	return pgx.BeginFunc(ctx, s.GlobalPool, func(tx pgx.Tx) error {
		qtx := s.Global.WithTx(tx)
		return fn(qtx)
	})
}
