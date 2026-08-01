package workers

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const heartbeatInterval = 30 * time.Second

func RunHeartbeat(ctx context.Context, pool *pgxpool.Pool, log *slog.Logger) {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	log.Info("heartbeat workers started", "interval", heartbeatInterval)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			var now time.Time
			if err := pool.QueryRow(ctx, `SELECT now()`).Scan(&now); err != nil {
				log.ErrorContext(ctx, "heartbeat failed", "error", err)
				continue
			}
			log.InfoContext(ctx, "heartbeat", "database_time", now)
		}
	}
}
