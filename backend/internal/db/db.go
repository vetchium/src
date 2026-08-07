package db

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const databaseConnectTimeout = 10 * time.Second

func Connect(ctx context.Context, databaseURL string, log *slog.Logger) (*pgxpool.Pool, error) {
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database configuration: %w", err)
	}
	if poolConfig.ConnConfig.ConnectTimeout == 0 {
		poolConfig.ConnConfig.ConnectTimeout = databaseConnectTimeout
	}
	if poolConfig.PingTimeout == 0 {
		poolConfig.PingTimeout = databaseConnectTimeout
	}

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("create database pool: %w", err)
	}

	connectCtx, cancel := context.WithTimeout(ctx, databaseConnectTimeout)
	defer cancel()
	if err := pool.Ping(connectCtx); err != nil {
		// Keep the pool open: pgx establishes connections lazily and replaces
		// unhealthy connections, so later operations can recover without a
		// process restart when PostgreSQL becomes available again.
		log.Warn("database unavailable; operations will retry through the connection pool", "error", err)
		return pool, nil
	}
	log.Info("database connected")
	return pool, nil
}
