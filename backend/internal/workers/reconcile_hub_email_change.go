package workers

import (
	"context"
	"fmt"
)

func (w *Worker) reconcileHubEmailChange(ctx context.Context) error {
	completed, err := w.hubEmailChangeRecovery.Recover(ctx)
	if completed > 0 {
		w.log.Info(
			"Hub account email change operations completed",
			"event", "hub_email_change_reconciled", "count", completed,
		)
	}
	if err != nil {
		return fmt.Errorf("reconcile Hub email change: %w", err)
	}
	return nil
}
