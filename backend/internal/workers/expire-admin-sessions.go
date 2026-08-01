package workers

import (
	"context"
	"log/slog"
	"time"
)

const AdminSessionExpiryInterval = time.Hour

type expiredSessionStore interface {
	DeleteExpiredAdminSessions(context.Context) (int64, error)
}

// RunExpireAdminSessions removes unusable session rows at startup and then at
// the positive interval supplied by the caller. Authentication rejects an
// expired row independently of this worker; this is table housekeeping.
func RunExpireAdminSessions(ctx context.Context, store expiredSessionStore, log *slog.Logger, interval time.Duration) {
	deleteExpired := func() {
		deleted, err := store.DeleteExpiredAdminSessions(ctx)
		if err != nil {
			if ctx.Err() == nil {
				log.ErrorContext(ctx, "expire admin sessions", "error", err)
			}
			return
		}
		if deleted > 0 {
			log.InfoContext(ctx, "expired admin sessions deleted", "count", deleted)
		}
	}

	deleteExpired()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			deleteExpired()
		}
	}
}
