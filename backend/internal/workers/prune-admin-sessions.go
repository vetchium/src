package workers

import (
	"context"
	"fmt"
)

func (w *Worker) pruneAdminSessions(ctx context.Context) error {
	deleted, err := w.queries.DeleteExpiredAdminSessions(ctx)
	if err != nil {
		return fmt.Errorf("delete expired admin sessions: %w", err)
	}
	if deleted > 0 {
		w.log.Info("expired admin sessions deleted", "count", deleted)
	}
	return nil
}
