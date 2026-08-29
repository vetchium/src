package workers

import (
	"context"
	"fmt"
)

func (w *Worker) pruneIdempotency(ctx context.Context) error {
	count, err := w.queries.PruneExpiredIdempotency(ctx)
	if err != nil {
		return fmt.Errorf("prune expired idempotency rows: %w", err)
	}
	if count > 0 {
		w.log.Info("expired idempotency rows deleted", "count", count)
	}
	return nil
}
