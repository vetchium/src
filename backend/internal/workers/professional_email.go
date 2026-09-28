package workers

import (
	"context"
	"fmt"
)

func (w *Worker) completeHubProfessionalEmailClaims(ctx context.Context) error {
	completed, err := w.professionalEmail.Recover(ctx)
	if err != nil {
		return fmt.Errorf("complete Hub professional email claims: %w", err)
	}
	if completed > 0 {
		w.log.Info(
			"Hub professional email operations completed",
			"event", "hub_professional_email_reconciled", "count", completed,
		)
	}
	return nil
}

// syncHubProfessionalEmailSupersessions pulls one batch from the
// coordinator's supersession feed. A detected gap (GU-PEM-006) runs the
// holdings sweep immediately instead of waiting for its own timer, since a
// gap means some supersession may never reach this tenant through the feed
// again.
func (w *Worker) syncHubProfessionalEmailSupersessions(ctx context.Context) error {
	result, err := w.professionalEmail.SyncSupersessions(ctx)
	if err != nil {
		return fmt.Errorf(
			"sync Hub professional email supersessions: %w", err,
		)
	}
	if result.StalePending > 0 {
		w.log.Warn(
			"Hub professional email supersession feed has a stale pending item",
			"event", "hub_professional_email_supersession_stale",
			"age", result.StalePending.String(),
		)
	}
	if result.GapDetected {
		w.log.Warn(
			"Hub professional email supersession watermark jumped; sweeping holdings now",
			"event", "hub_professional_email_supersession_gap",
		)
		if err := w.professionalEmail.SweepHoldings(ctx); err != nil {
			return fmt.Errorf(
				"sweep Hub professional email holdings after gap: %w", err,
			)
		}
	}
	return nil
}

func (w *Worker) sweepHubProfessionalEmailHoldings(ctx context.Context) error {
	if err := w.professionalEmail.SweepHoldings(ctx); err != nil {
		return fmt.Errorf("sweep Hub professional email holdings: %w", err)
	}
	return nil
}
