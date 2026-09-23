package workers

import (
	"context"
	"fmt"
)

func (w *Worker) reconcileHubSignup(ctx context.Context) error {
	completed, err := w.hubSignupRecovery.Recover(ctx)
	if err != nil {
		return fmt.Errorf("reconcile Hub signup: %w", err)
	}
	if completed > 0 {
		w.log.Info(
			"Hub signup operations completed",
			"event", "hub_signup_reconciled", "count", completed,
		)
	}
	return nil
}
